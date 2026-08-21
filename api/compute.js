import { HARDWARE_PRESETS, SCENARIO_PRESETS } from '../src/utils/presets.js';
import {
  singleTurn,
  speculative,
  batched,
  agentic,
  kvCache,
  cost
} from './_math.js';
import { ENGINE_FLAGS, applyEngineFlags } from '../src/utils/engineFlags.js';
import { enforceRateLimit } from './_ratelimit.js';
import { sendJson, withSchemaVersion, applySchemaHeaders } from './_schema.js';

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

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Run one parameter set. Returns { status, body } — never throws for
// expected input problems; unexpected math errors bubble up to the caller.
function computeOne(params) {
  const model = params.model || params.m || '';

  switch (model) {
    case 'singleTurn':
      return { status: 200, body: singleTurn({
        promptTokens: num(params.promptTokens, 2048),
        outputTokens: num(params.outputTokens, 512),
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105)
      }) };

    case 'speculative':
      return { status: 200, body: speculative({
        baseDecodeSpeed: num(params.baseDecodeSpeed ?? params.decodeSpeed, 105),
        draftTokens: num(params.draftTokens, 4),
        acceptanceRate: num(params.acceptanceRate, 0.7),
        draftCostFraction: num(params.draftCostFraction, 0.2)
      }) };

    case 'batched':
      return { status: 200, body: batched({
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105),
        batchSize: num(params.batchSize, 1),
        promptTokens: num(params.promptTokens, 4096),
        outputTokens: num(params.outputTokens, 512),
        decodeDecayExponent: num(params.decodeDecayExponent, 0.25)
      }) };

    case 'agentic':
      return { status: 200, body: agentic({
        numTurns: Math.min(50, Math.max(1, num(params.numTurns, 4))),
        basePromptTokens: num(params.basePromptTokens, 1500),
        toolOutputTokensPerTurn: num(params.toolOutputTokensPerTurn, 800),
        decodeTokensPerTurn: num(params.decodeTokensPerTurn, 250),
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105),
        enablePrefixCaching: params.enablePrefixCaching !== 'false' && params.enablePrefixCaching !== false
      }) };

    case 'kvCache': {
      const presetKey = params.architecture;
      const preset = presetKey ? MODEL_PRESETS[presetKey] : null;
      return { status: 200, body: kvCache({
        numLayers: num(params.numLayers, preset?.numLayers ?? 80),
        kvHeads: num(params.kvHeads, preset?.kvHeads ?? 8),
        headDim: num(params.headDim, preset?.headDim ?? 128),
        contextLength: num(params.contextLength, 32768),
        precisionBytes: num(params.precisionBytes, 2),
        batchSize: num(params.batchSize, 1)
      }) };
    }

    case 'flagged': {
      // Engine flag modeling (issue #70): apply documented llama.cpp/vLLM
      // flag deltas to base speeds, then simulate a single turn with them.
      // The response carries a per-flag audit trail (delta + source tag) so
      // agents can see exactly how each number was adjusted.
      const flags = applyEngineFlags({
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105),
        flags: params.flags ?? ''
      });
      const promptTokens = num(params.promptTokens, 2048);
      const outputTokens = num(params.outputTokens, 512);
      return { status: 200, body: {
        inputs: { ...flags.inputs, promptTokens, outputTokens },
        adjusted: flags.adjusted,
        totalPrefillDeltaPct: flags.totalPrefillDeltaPct,
        totalDecodeDeltaPct: flags.totalDecodeDeltaPct,
        adjustments: flags.adjustments,
        warnings: flags.warnings,
        simulation: singleTurn({
          promptTokens,
          outputTokens,
          prefillSpeed: flags.adjusted.prefillSpeed,
          decodeSpeed: flags.adjusted.decodeSpeed
        })
      } };
    }

    case 'cost':
      return { status: 200, body: cost({
        hardwarePriceUsd: num(params.hardwarePriceUsd ?? params.price, 0),
        electricityRatePerKwh: num(params.electricityRatePerKwh ?? params.electricityRate, 0.15),
        powerDrawWatts: num(params.powerDrawWatts, 0),
        amortizationMonths: num(params.amortizationMonths, 36),
        promptTokens: num(params.promptTokens, 2048),
        outputTokens: num(params.outputTokens, 512),
        prefillSpeed: num(params.prefillSpeed, 3800),
        decodeSpeed: num(params.decodeSpeed, 105)
      }) };

    case '':
    case undefined:
      return { status: 200, body: capabilityList() };

    default:
      return { status: 400, body: { error: `Unknown model '${model}'`, available: ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache', 'flagged', 'cost'] } };
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
    otherEndpoints: ['/api/vram', '/api/presets', '/api/localmaxxing', '/llms.txt']
  };
}

// Batch payload: an array of parameter sets, accepted as
//   POST { "batch": [...] }   (also "variants" as an alias)
//   GET  /api/compute?batch=[{"model":"..."},...]   (URL-encoded JSON)
// Returns 200 with per-item ok/error entries so one bad scenario
// never fails the whole comparison.
function runBatch(rawItems) {
  let items = rawItems;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      return { status: 400, body: { error: 'batch must be a JSON array of parameter sets (could not parse batch as JSON)' } };
    }
  }

  if (!Array.isArray(items)) {
    return { status: 400, body: { error: 'batch must be a JSON array of parameter sets' } };
  }
  if (items.length === 0) {
    return { status: 400, body: { error: 'batch must contain at least one parameter set' } };
  }
  if (items.length > MAX_BATCH_SIZE) {
    return { status: 400, body: { error: `batch exceeds maximum of ${MAX_BATCH_SIZE} parameter sets (got ${items.length})`, maxSize: MAX_BATCH_SIZE } };
  }

  const results = items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { index, ok: false, error: 'batch item must be an object with a "model" field' };
    }
    try {
      const { status, body } = computeOne(item);
      // Stamp schema_version so batch items match individual call bodies.
      if (status === 200) return { index, ok: true, result: withSchemaVersion(body) };
      return { index, ok: false, error: body?.error || 'unknown error' };
    } catch (err) {
      return { index, ok: false, error: String(err.message || err) };
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

  // Batched mode: ?batch=[...] / POST {"batch":[...]} ("variants" alias)
  const rawBatch = params.batch ?? params.variants;
  if (rawBatch !== undefined) {
    const { status, body } = runBatch(rawBatch);
    return json(res, body, status);
  }

  try {
    const { status, body } = computeOne(params);
    return json(res, body, status);
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 500);
  }
}
