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

export const config = { runtime: 'nodejs' };

// Max parameter sets accepted in one batch call (documented in the
// capability list and /llms.txt). Keeps responses bounded.
export const MAX_BATCH_SIZE = 50;

const MODEL_PRESETS = {
  llama70b:  { numLayers: 80, hiddenSize: 8192, kvHeads: 8, numHeads: 64, headDim: 128 },
  llama8b:   { numLayers: 32, hiddenSize: 4096, kvHeads: 8, numHeads: 32, headDim: 128 },
  qwen72b:   { numLayers: 80, hiddenSize: 8192, kvHeads: 8, numHeads: 64, headDim: 128 },
  mistral7b: { numLayers: 32, hiddenSize: 4096, kvHeads: 8, numHeads: 32, headDim: 128 }
};

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
      const inputs = {
        numTurns: Math.min(50, Math.max(1, num(params.numTurns, 4))),
        basePromptTokens: num(params.basePromptTokens, 1500),
        toolOutputTokensPerTurn: num(params.toolOutputTokensPerTurn, 800),
        decodeTokensPerTurn: num(params.decodeTokensPerTurn, 250),
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105),
        enablePrefixCaching: params.enablePrefixCaching !== 'false' && params.enablePrefixCaching !== false
      };
      return withId('agentic', inputs, agentic(inputs), dryRun);
    }

    case 'kvCache': {
      const presetKey = params.architecture;
      const preset = presetKey ? MODEL_PRESETS[presetKey] : null;
      const inputs = {
        architecture: presetKey || 'generic',
        numLayers: num(params.numLayers, preset?.numLayers ?? 80),
        kvHeads: num(params.kvHeads, preset?.kvHeads ?? 8),
        headDim: num(params.headDim, preset?.headDim ?? 128),
        contextLength: num(params.contextLength, 32768),
        precisionBytes: num(params.precisionBytes, 2),
        batchSize: num(params.batchSize, 1)
      };
      return withId('kvCache', inputs, kvCache(inputs), dryRun);
    }

    case 'flagged': {
      // Engine flag modeling (issue #70): apply documented llama.cpp/vLLM
      // flag deltas to base speeds, then simulate a single turn with them.
      // The response carries a per-flag audit trail (delta + source tag) so
      // agents can see exactly how each number was adjusted.
      const flags = params.flags ?? '';
      if (dryRun) {
        return { status: 200, body: dryRunBody('flagged', {
          prefillSpeed: num(params.prefillSpeed, 3800),
          decodeSpeed: num(params.decodeSpeed, 105),
          promptTokens: num(params.promptTokens, 2048),
          outputTokens: num(params.outputTokens, 512),
          flags
        }) };
      }
      const flaggedInputs = applyEngineFlags({
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105),
        flags
      });
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
      return { status: 200, body: cost(costInputs) };
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
      description: 'Compare variants in one call: POST {"batch": [{"model": "singleTurn", "promptTokens": 4096}, ...]}. Each item is a normal parameter set including its own "model" field. Returns { results: [{ index, ok, result | error }] } — one bad item does not fail the batch.',
      maxSize: MAX_BATCH_SIZE,
      example: { batch: [{ model: 'singleTurn', promptTokens: 4096 }, { model: 'kvCache', architecture: 'llama70b', contextLength: 131072 }] }
    },
    sanity: {
      description: 'Non-blocking implausibility warnings. Every successful result carries a "warnings" array (empty when inputs are plausible) flagging outputs that violate known physical bounds: decode above the memory-bandwidth roofline, prefill above the compute roofline, or TTFT below the kernel-launch floor. Warnings never change the math or the HTTP status.',
      codes: ['decode_above_bandwidth_roofline', 'prefill_above_compute_roofline', 'ttft_below_kernel_launch_floor'],
      example: '/api/compute?model=singleTurn&promptTokens=64&prefillSpeed=900000&decodeSpeed=5000'
    },
    dryRun: {
      description: 'Add &dry_run=true (or "dry_run": true in a POST body) to validate a request and echo the parsed parameters (defaults filled in, numbers coerced) WITHOUT executing any math — a cheap sanity check for agents debugging malformed payloads. Works on GET and POST, and applies per-item inside a batch. The response carries the same deterministic id the real call would return. Unknown models and malformed batches fail exactly as they would for a real call.',
      response: '{ dry_run: true, model, inputs, id?, note }',
      example: '/api/compute?model=agentic&numTurns=6&enablePrefixCaching=true&dry_run=true'
    },
    otherEndpoints: ['/api/vram', '/api/presets', '/api/localmaxxing', '/llms.txt']
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
      return { index, ok: false, code: 'INVALID_PARAMS', error: 'batch item must be an object with a "model" field' };
    }
    try {
      const { status, body } = computeOne(item, dryRun);
      // Stamp schema_version + the same deterministic calc id an individual
      // call would get, so batch results match standalone calls (#68).
      if (status === 200) return { index, ok: true, result: { id: computeCalcId('compute', { model: item.model || item.m || '', ...item }), ...withSchemaVersion(body) } };
      return { index, ok: false, code: body?.code || 'INTERNAL', error: body?.detail || body?.title || body?.error || 'unknown error' };
    } catch (err) {
      return { index, ok: false, code: err instanceof ApiError ? err.code : 'INTERNAL', error: String(err.message || err) };
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
    if (out.status === 200) out.body = { id: computeCalcId('compute', params), ...out.body };
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
