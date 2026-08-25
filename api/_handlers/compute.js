import { HARDWARE_PRESETS, SCENARIO_PRESETS } from '../../src/utils/presets.js';
import {
  singleTurn,
  speculative,
  batched,
  agentic,
  kvCache,
  cost
} from '../_math.js';
import { ENGINE_FLAGS, applyEngineFlags } from '../../src/utils/engineFlags.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson, withSchemaVersion, applySchemaHeaders } from '../_schema.js';
import { ApiError, sendProblemFromError } from '../_errors.js';
import { computeCalcId } from '../_calc_id.js';
import { normalizeParams } from '../_calc_id.js';
import { annotate, THEORETICAL } from '../_basis.js';
import { empiricalDecayExponentCaveat, heuristicFlagDeltasCaveat } from '../_caveats.js';
import { ROUTES } from '../_route_table.js';

export const config = { runtime: 'nodejs' };

// otherEndpoints for the bare /api/compute capability index (#712): derived
// from the central route table (the same source of truth behind agents.json)
// so the self-describing front door always advertises the FULL surface —
// including /api/spec itself — instead of a hand-picked subset. /compute is
// excluded (this response IS that endpoint); non-route doc surfaces that
// agents need at bootstrap (/llms.txt) are appended explicitly.
const OTHER_ENDPOINTS = [
  ...ROUTES.filter(r => r.path !== '/compute').map(r => `/api${r.path}`),
  '/llms.txt'
];


// Max parameter sets accepted in one batch call (documented in the
// capability list and /llms.txt). Keeps responses bounded.
export const MAX_BATCH_SIZE = 50;

const MODEL_PRESETS = {
  llama70b:  { numLayers: 80, hiddenSize: 8192, kvHeads: 8, numHeads: 64, headDim: 128, maxContext: 131072 },
  llama8b:   { numLayers: 32, hiddenSize: 4096, kvHeads: 8, numHeads: 32, headDim: 128, maxContext: 131072 },
  qwen72b:   { numLayers: 80, hiddenSize: 8192, kvHeads: 8, numHeads: 64, headDim: 128, maxContext: 131072 },
  mistral7b: { numLayers: 32, hiddenSize: 4096, kvHeads: 8, numHeads: 32, headDim: 128, maxContext: 131072 }
};

// Documented KV-cache precisions (/api/spec declares enum [2, 1, 0.5]).
const PRECISION_BYTES_ENUM = [2, 1, 0.5];

// Integer-valued kvCache inputs where values < 1 are physically invalid
// (#775): zero or negative context/batch/layers cancel signs and yield
// plausible-looking garbage.
function positiveIntParam(params, name, fallback) {
  const raw = params[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new ApiError('INVALID_PARAMS', `${name} must be a number (got '${raw}')`, {
      extras: { param: name, received: String(raw) }
    });
  }
  const rounded = Math.round(n);
  if (rounded < 1) {
    throw new ApiError('INVALID_PARAMS', `${name} must be >= 1 (got ${n}) — non-positive values are physically invalid for KV-cache geometry`, {
      extras: { param: name, received: n }
    });
  }
  return rounded;
}

// Thin wrapper over the shared sender so every response carries
// schema_version + X-Schema-Version (see _schema.js / CHANGELOG-API.md).
function json(res, body, status = 200) {
  return sendJson(res, body, { status });
}

// Stamp a deterministic calc_<hash> id derived from the RESOLVED inputs,
// so omitting an explicit default yields the identical id (#68).
// With dryRun, skip the math entirely and echo the parsed inputs instead
// (#17): the id is the SAME hash a real call with these inputs would
// return, so a dry run can be swapped for the real call 1:1.
function withId(model, inputs, result, dryRun = false) {
  const id = computeCalcId('compute', { model, ...normalizeParams(inputs) });
  if (dryRun) return { status: 200, body: dryRunBody(model, inputs, id) };
  return { status: 200, body: { id, ...result } };
}

// dry_run=true (or 1 / dryRun alias): validate + echo, never execute (#17).
export function isDryRun(params = {}) {
  const v = params.dry_run ?? params.dryRun;
  return v === true || v === 'true' || v === '1' || v === 1;
}

function dryRunBody(model, inputs, id) {
  return {
    dry_run: true,
    model,
    inputs,
    ...(id ? { id } : {}),
    note: 'Validated only — nothing was computed. Resend without dry_run to execute; a dry_run request returns the same deterministic id as the real call.'
  };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Run one parameter set. Returns { status, body } — never throws for
// expected input problems; unexpected math errors bubble up to the caller.
// With dryRun, each branch validates + echoes its parsed inputs instead of
// executing the simulation (#17).
function computeOne(params, dryRun = false) {
  const model = params.model || params.m || '';

  switch (model) {
    case 'singleTurn': {
      const inputs = {
        promptTokens: num(params.promptTokens, 2048),
        outputTokens: num(params.outputTokens, 512),
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105)
      };
      return withId('singleTurn', inputs, singleTurn(inputs), dryRun);
    }

    case 'speculative': {
      const inputs = {
        baseDecodeSpeed: num(params.baseDecodeSpeed ?? params.decodeSpeed, 105),
        draftTokens: num(params.draftTokens, 4),
        acceptanceRate: num(params.acceptanceRate, 0.7),
        draftCostFraction: num(params.draftCostFraction, 0.2)
      };
      return withId('speculative', inputs, speculative(inputs), dryRun);
    }

    case 'batched': {
      const inputs = {
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105),
        batchSize: num(params.batchSize, 1),
        promptTokens: num(params.promptTokens, 4096),
        outputTokens: num(params.outputTokens, 512),
        decodeDecayExponent: num(params.decodeDecayExponent, 0.25)
      };
      return withId('batched', inputs, batched(inputs), dryRun);
    }

    case 'agentic': {
      const requested = Math.min(50, Math.max(1, num(params.numTurns, 4)));
      // #783: the spec declares numTurns an integer but fractional values
      // were accepted, floored silently by the turn loop, and echoed back
      // verbatim in inputs (so the calc id hashed a count that never ran).
      // Floor at parse time so `inputs.numTurns` echoes the EXECUTED count,
      // and flag the coercion in warnings[] when it engaged.
      const numTurns = Math.floor(requested);
      const inputs = {
        numTurns,
        basePromptTokens: num(params.basePromptTokens, 1500),
        toolOutputTokensPerTurn: num(params.toolOutputTokensPerTurn, 800),
        decodeTokensPerTurn: num(params.decodeTokensPerTurn, 250),
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105),
        enablePrefixCaching: params.enablePrefixCaching !== 'false' && params.enablePrefixCaching !== false
      };
      const result = agentic(inputs);
      if (numTurns !== requested) {
        result.warnings.push({
          code: 'num_turns_floored',
          message: `numTurns=${requested} is fractional — the simulation ran ${numTurns} turns; inputs echo the executed count.`
        });
      }
      return withId('agentic', inputs, result, dryRun);
    }

    case 'kvCache': {
      const presetKey = params.architecture;
      if (presetKey && !MODEL_PRESETS[presetKey]) {
        throw new ApiError('INVALID_PARAMS', `Unknown architecture '${presetKey}'`, {
          extras: { available: Object.keys(MODEL_PRESETS) }
        });
      }
      const preset = presetKey ? MODEL_PRESETS[presetKey] : null;

      // Input validation (#775): reject non-numeric and non-positive values
      // instead of silently defaulting or multiplying sign-cancelled garbage.
      const inputs = {
        architecture: presetKey || 'generic',
        numLayers: positiveIntParam(params, 'numLayers', preset?.numLayers ?? 80),
        kvHeads: positiveIntParam(params, 'kvHeads', preset?.kvHeads ?? 8),
        headDim: positiveIntParam(params, 'headDim', preset?.headDim ?? 128),
        contextLength: positiveIntParam(params, 'contextLength', 32768),
        precisionBytes: (() => {
          const raw = params.precisionBytes;
          if (raw === undefined || raw === null || raw === '') return 2;
          const n = Number(raw);
          if (!Number.isFinite(n) || !PRECISION_BYTES_ENUM.includes(n)) {
            throw new ApiError('INVALID_PARAMS', `precisionBytes must be one of ${PRECISION_BYTES_ENUM.join(', ')} (FP16/FP8/INT4); got '${raw}'`, {
              extras: { param: 'precisionBytes', allowed: PRECISION_BYTES_ENUM }
            });
          }
          return n;
        })(),
        batchSize: positiveIntParam(params, 'batchSize', 1)
      };

      const warnings = [];

      // Context-window check (#828): mirrors /api/vram's contextWindow
      // (withinLimit / overflowTokens) against the architecture's own
      // max_position_embeddings. Generic geometry has no known limit → null.
      const maxCtx = preset?.maxContext ?? null;
      const withinLimit = maxCtx == null ? null : inputs.contextLength <= maxCtx;
      const overflowTokens = maxCtx != null ? Math.max(0, inputs.contextLength - maxCtx) : null;
      if (withinLimit === false) {
        warnings.push({
          code: 'context_exceeds_model_limit',
          message: `contextLength ${inputs.contextLength.toLocaleString('en-US')} exceeds ${inputs.architecture}'s maximum context of ${maxCtx.toLocaleString('en-US')} by ${overflowTokens.toLocaleString('en-US')} tokens — the result is a hypothetical, not a runnable configuration`
        });
      }

      const result = {
        ...kvCache(inputs),
        warnings, // always present (#798) — ComputeResult requires it
        ...(maxCtx != null ? { contextWindow: { maxPositionEmbeddings: maxCtx, requested: inputs.contextLength, withinLimit, overflowTokens } } : {})
      };
      return withId('kvCache', inputs, result, dryRun);
    }

    case 'flagged': {
      // Engine flag modeling (issue #70): apply documented llama.cpp/vLLM
      // flag deltas to base speeds, then simulate a single turn with them.
      // The response carries a per-flag audit trail (delta + source tag) so
      // agents can see exactly how each number was adjusted.
      const flags = params.flags ?? '';
      // Validate flags on BOTH paths (#871): run the same applyEngineFlags
      // pass the real call uses so a dry run surfaces unknown ids and unmet
      // flag dependencies (warnings[]) instead of echoing garbage clean.
      const flaggedInputs = applyEngineFlags({
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105),
        flags
      });
      if (dryRun) {
        return { status: 200, body: {
          ...dryRunBody('flagged', {
            ...flaggedInputs.inputs,
            promptTokens: num(params.promptTokens, 2048),
            outputTokens: num(params.outputTokens, 512)
          }),
          warnings: flaggedInputs.warnings
        } };
      }
      const promptTokens = num(params.promptTokens, 2048);
      const outputTokens = num(params.outputTokens, 512);
      return { status: 200, body: {
        inputs: { ...flaggedInputs.inputs, promptTokens, outputTokens },
        adjusted: flaggedInputs.adjusted,
        totalPrefillDeltaPct: flaggedInputs.totalPrefillDeltaPct,
        totalDecodeDeltaPct: flaggedInputs.totalDecodeDeltaPct,
        adjustments: flaggedInputs.adjustments,
        warnings: flaggedInputs.warnings,
        simulation: singleTurn({
          promptTokens,
          outputTokens,
          prefillSpeed: flaggedInputs.adjusted.prefillSpeed,
          decodeSpeed: flaggedInputs.adjusted.decodeSpeed
        })
      } };
    }

    case 'cost': {
      const costInputs = {
        hardwarePriceUsd: num(params.hardwarePriceUsd ?? params.price, 0),
        electricityRatePerKwh: num(params.electricityRatePerKwh ?? params.electricityRate, 0.15),
        powerDrawWatts: num(params.powerDrawWatts, 0),
        amortizationMonths: num(params.amortizationMonths, 36),
        promptTokens: num(params.promptTokens, 2048),
        outputTokens: num(params.outputTokens, 512),
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105)
      };
      if (dryRun) return { status: 200, body: dryRunBody('cost', costInputs) };
      // #736: bare model=cost calls default price AND power to 0, which makes
      // every operating-cost figure come out $0.00 — flag the unset inputs so
      // the result can't be mistaken for a real quote.
      const warnings = [];
      if (costInputs.hardwarePriceUsd === 0) {
        warnings.push({
          code: 'cost_hardware_price_unset',
          message: 'hardwarePriceUsd=0 (default) — hardware amortization contributes nothing; pass ?hardwarePriceUsd= for a total-cost-of-ownership figure.'
        });
      }
      if (costInputs.powerDrawWatts === 0) {
        warnings.push({
          code: 'cost_power_draw_unset',
          message: 'powerDrawWatts=0 (default) — electricity contributes nothing; pass ?powerDrawWatts= for a realistic $/1M tokens.'
        });
      }
      return { status: 200, body: { ...cost(costInputs), warnings } };
    }

    case '':
    case undefined:
      return { status: 200, body: capabilityList() };

    default:
      throw new ApiError('INVALID_PARAMS', `Unknown model '${model}'`, {
        extras: { available: ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache', 'flagged', 'cost'] }
      });
  }
}

function capabilityList() {
  return {
    description: 'LLM inference math API. Pass ?model=<name> plus parameters, or batch up to 50 parameter sets via POST {"batch":[...]} (or ?batch=[...] as JSON).',
    models: {
      singleTurn: { params: ['promptTokens', 'outputTokens', 'prefillSpeed', 'decodeSpeed'], example: '/api/compute?model=singleTurn&promptTokens=4096&outputTokens=512&prefillSpeed=3800&decodeSpeed=105' },
      speculative: { params: ['baseDecodeSpeed', 'draftTokens', 'acceptanceRate', 'draftCostFraction'], example: '/api/compute?model=speculative&baseDecodeSpeed=105&draftTokens=4&acceptanceRate=0.7' },
      batched: { params: ['prefillSpeed', 'decodeSpeed', 'batchSize', 'promptTokens', 'outputTokens', 'decodeDecayExponent'], example: '/api/compute?model=batched&batchSize=16&decodeSpeed=105' },
      agentic: { params: ['numTurns', 'basePromptTokens', 'toolOutputTokensPerTurn', 'decodeTokensPerTurn', 'prefillSpeed', 'decodeSpeed', 'enablePrefixCaching'], example: '/api/compute?model=agentic&numTurns=6&enablePrefixCaching=true' },
      kvCache: { params: ['architecture|numLayers+kvHeads+headDim', 'contextLength', 'precisionBytes', 'batchSize'], architectures: Object.keys(MODEL_PRESETS), example: '/api/compute?model=kvCache&architecture=llama70b&contextLength=65536' },
      flagged: {
        params: ['prefillSpeed', 'decodeSpeed', 'promptTokens', 'outputTokens', 'flags'],
        flags: Object.fromEntries(ENGINE_FLAGS.map(f => [f.id, { flag: f.flag, engine: f.engine, prefillDeltaPct: Math.round((f.prefillMult - 1) * 100), decodeDeltaPct: Math.round((f.decodeMult - 1) * 100), kvBits: f.kvBits, source: f.source, sourceNote: f.sourceNote }])),
        description: 'Applies documented engine launch-flag deltas to base speeds and simulates a single turn. All deltas are heuristics with a source note each — not measurements.',
        example: '/api/compute?model=flagged&prefillSpeed=2400&decodeSpeed=65&flags=flash-attn,kv-q8'
      },
      cost: { params: ['hardwarePriceUsd', 'electricityRatePerKwh', 'powerDrawWatts', 'amortizationMonths', 'promptTokens', 'outputTokens', 'prefillSpeed', 'decodeSpeed'], example: '/api/compute?model=cost&hardwarePriceUsd=2000&electricityRatePerKwh=0.15&powerDrawWatts=450&prefillSpeed=3800&decodeSpeed=105' }
    },
    batch: {
      description: 'Compare variants in one call: POST {"batch": [{"model": "singleTurn", "promptTokens": 4096}, ...]}. Each item is a normal parameter set including its own "model" field. Returns { results: [{ index, ok, result | error }] } — one bad item does not fail the batch. Failed entries echo their input ("inputs", or "input" for non-object items) and carry a deterministic per-item id plus ApiError extras such as available[], so a subset retry can be correlated by id instead of index. Optionally pass a top-level "batchId" string to pin the response id across subset retries: every attempt under the same batchId returns the same id, verifiable via /api/calc/<id>?batchId=<batchId>.',
      maxSize: MAX_BATCH_SIZE,
      example: { batch: [{ model: 'singleTurn', promptTokens: 4096 }, { model: 'kvCache', architecture: 'llama70b', contextLength: 131072 }] }
    },
    sanity: {
      description: 'Non-blocking implausibility warnings. Every successful result carries a "warnings" array (empty when inputs are plausible) flagging outputs that violate known physical bounds: decode above the memory-bandwidth roofline, prefill above the compute roofline, TTFT below the kernel-launch floor, or (kvCache) a contextLength beyond the architecture max context. Warnings never change the math or the HTTP status.',
      codes: ['decode_above_bandwidth_roofline', 'prefill_above_compute_roofline', 'ttft_below_kernel_launch_floor', 'context_exceeds_model_limit'],
      example: '/api/compute?model=singleTurn&promptTokens=64&prefillSpeed=900000&decodeSpeed=5000'
    },
    dryRun: {
      description: 'Add &dry_run=true (or "dry_run": true in a POST body) to validate a request and echo the parsed parameters (defaults filled in, numbers coerced) WITHOUT executing any math — a cheap sanity check for agents debugging malformed payloads. Works on GET and POST, and applies per-item inside a batch. The response carries the same deterministic id the real call would return. Unknown models and malformed batches fail exactly as they would for a real call.',
      response: '{ dry_run: true, model, inputs, id?, note }',
      example: '/api/compute?model=agentic&numTurns=6&enablePrefixCaching=true&dry_run=true'
    },
    otherEndpoints: OTHER_ENDPOINTS
  };
}

// Batch payload: an array of parameter sets, accepted as
//   POST { "batch": [...] }   (also "variants" as an alias)
//   GET  /api/compute?batch=[{"model":"..."},...]   (URL-encoded JSON)
// Returns 200 with per-item ok/error entries so one bad scenario
// never fails the whole comparison.
function runBatch(rawItems, dryRun = false) {
  let items = rawItems;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      throw new ApiError('INVALID_PARAMS', 'batch must be a JSON array of parameter sets (could not parse batch as JSON)');
    }
  }

  if (!Array.isArray(items)) {
    throw new ApiError('INVALID_PARAMS', 'batch must be a JSON array of parameter sets');
  }
  if (items.length === 0) {
    throw new ApiError('INVALID_PARAMS', 'batch must contain at least one parameter set');
  }
  if (items.length > MAX_BATCH_SIZE) {
    throw new ApiError('INVALID_PARAMS', `batch exceeds maximum of ${MAX_BATCH_SIZE} parameter sets (got ${items.length})`, {
      extras: { maxSize: MAX_BATCH_SIZE }
    });
  }

  const results = items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      // #964: echo the offending value so a response held in isolation (async
      // processing, log inspection, forwarded result) still says WHAT failed,
      // not just where.
      return {
        index,
        ok: false,
        code: 'INVALID_PARAMS',
        error: 'batch item must be an object with a "model" field',
        input: item ?? null
      };
    }
    // #964: every object item carries a deterministic per-item id hashed from
    // its content. A failed item keeps this id across subset retries, so
    // attempt N+1 can be correlated to attempt N without trusting positional
    // indexes (which renumber when only the failed subset is resent).
    const itemId = computeCalcId('compute', { model: item.model || item.m || '', ...item });
    try {
      const { status, body } = computeOne(item, dryRun);
      // Stamp schema_version + the same deterministic calc id an individual
      // call would get, so batch results match standalone calls (#68).
      if (status === 200) return { index, ok: true, result: { id: itemId, ...withSchemaVersion(body) } };
      return {
        index,
        ok: false,
        id: itemId,
        code: body?.code || 'INTERNAL',
        error: body?.detail || body?.title || body?.error || 'unknown error',
        inputs: item, // #964: echo the failed input
        ...(body?.available ? { available: body.available } : {}) // #964
      };
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      return {
        index,
        ok: false,
        id: itemId,
        code: apiErr ? err.code : 'INTERNAL',
        error: String(err.message || err),
        inputs: item, // #964: echo the failed input
        ...(apiErr?.extras ?? {}) // #964: preserve available[] and other extras
      };
    }
  });

  return {
    status: 200,
    body: {
      batch: true,
      count: results.length,
      okCount: results.filter(r => r.ok).length,
      errorCount: results.filter(r => !r.ok).length,
      results
    }
  };
}

/**
 * Shared core for /api/compute and /api/calc/<id> replay (issue #68).
 * Returns { status, body }; successful bodies carry a deterministic `id`
 * hashed from the raw request parameters.
 */
export function computeBody(params = {}) {
  // dry_run mode (#17): validate + echo parsed params without executing.
  // Applies to single calls and per-item inside a batch alike.
  const dryRun = isDryRun(params);

  // Batched mode: ?batch=[...] / POST {"batch":[...]} ("variants" alias)
  const rawBatch = params.batch ?? params.variants;
  if (rawBatch !== undefined) {
    const out = runBatch(rawBatch, dryRun);
    if (out.status === 200) {
      // #964: a caller-supplied `batchId` pins the top-level batch id — it
      // hashes ONLY the batchId string, so resending any subset of the
      // batch's items under the same batchId mints the SAME id instead of a
      // fresh one. Without batchId the id stays a hash of the full request.
      const rawBatchId = params.batchId;
      const batchId = rawBatchId !== undefined && rawBatchId !== null && rawBatchId !== '' && typeof rawBatchId !== 'object'
        ? String(rawBatchId)
        : null;
      out.body.id = batchId ? computeCalcId('compute', { batchId }) : computeCalcId('compute', params);
      if (batchId) out.body.batchId = batchId;
    }
    return out;
  }

  try {
    const out = computeOne(params, dryRun);
    if (out.status === 200 && out.body) {
      out.body = { id: computeCalcId('compute', { model: params.model || params.m || '', ...params }), ...out.body };
    }
    return out;
  } catch (err) {
    // Let ApiErrors reach the handler's problem+json renderer untouched.
    if (err instanceof ApiError) throw err;
    return { status: 500, body: { error: String(err.message || err) } };
  }
}

export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    applySchemaHeaders(res);
    return res.status(204).end();
  }
  if (!enforceRateLimit(req, res)) return;

  // Accept both GET (?model=singleTurn&promptTokens=...) and POST (JSON body)
  const params = req.method === 'POST' ? (req.body || {}) : req.query;

  try {
    const { status, body } = computeBody(params);
    return json(res, body, status);
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
