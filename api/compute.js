import { HARDWARE_PRESETS, SCENARIO_PRESETS } from '../src/utils/presets.js';
import {
  singleTurn,
  speculative,
  batched,
  agentic,
  kvCache
} from './_math.js';

export const config = { runtime: 'nodejs' };

const MODEL_PRESETS = {
  llama70b:  { numLayers: 80, hiddenSize: 8192, kvHeads: 8, numHeads: 64, headDim: 128 },
  llama8b:   { numLayers: 32, hiddenSize: 4096, kvHeads: 8, numHeads: 32, headDim: 128 },
  qwen72b:   { numLayers: 80, hiddenSize: 8192, kvHeads: 8, numHeads: 64, headDim: 128 },
  mistral7b: { numLayers: 32, hiddenSize: 4096, kvHeads: 8, numHeads: 32, headDim: 128 }
};

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body, null, 2));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  // Accept both GET (?model=singleTurn&promptTokens=...) and POST (JSON body)
  const params = req.method === 'POST' ? (req.body || {}) : req.query;
  const model = params.model || params.m || '';

  try {
    switch (model) {
      case 'singleTurn':
        return json(res, singleTurn({
          promptTokens: num(params.promptTokens, 2048),
          outputTokens: num(params.outputTokens, 512),
          prefillSpeed: num(params.prefillSpeed, 3800),
          decodeSpeed: num(params.decodeSpeed, 105)
        }));

      case 'speculative':
        return json(res, speculative({
          baseDecodeSpeed: num(params.baseDecodeSpeed ?? params.decodeSpeed, 105),
          draftTokens: num(params.draftTokens, 4),
          acceptanceRate: num(params.acceptanceRate, 0.7),
          draftCostFraction: num(params.draftCostFraction, 0.2)
        }));

      case 'batched':
        return json(res, batched({
          prefillSpeed: num(params.prefillSpeed, 3800),
          decodeSpeed: num(params.decodeSpeed, 105),
          batchSize: num(params.batchSize, 1),
          promptTokens: num(params.promptTokens, 4096),
          outputTokens: num(params.outputTokens, 512),
          decodeDecayExponent: num(params.decodeDecayExponent, 0.25)
        }));

      case 'agentic':
        return json(res, agentic({
          numTurns: Math.min(50, Math.max(1, num(params.numTurns, 4))),
          basePromptTokens: num(params.basePromptTokens, 1500),
          toolOutputTokensPerTurn: num(params.toolOutputTokensPerTurn, 800),
          decodeTokensPerTurn: num(params.decodeTokensPerTurn, 250),
          prefillSpeed: num(params.prefillSpeed, 3800),
          decodeSpeed: num(params.decodeSpeed, 105),
          enablePrefixCaching: params.enablePrefixCaching !== 'false' && params.enablePrefixCaching !== false
        }));

      case 'kvCache': {
        const presetKey = params.architecture;
        const preset = presetKey ? MODEL_PRESETS[presetKey] : null;
        return json(res, kvCache({
          numLayers: num(params.numLayers, preset?.numLayers ?? 80),
          kvHeads: num(params.kvHeads, preset?.kvHeads ?? 8),
          headDim: num(params.headDim, preset?.headDim ?? 128),
          contextLength: num(params.contextLength, 32768),
          precisionBytes: num(params.precisionBytes, 2),
          batchSize: num(params.batchSize, 1)
        }));
      }

      case '':
      case undefined:
        // No model → capability discovery
        return json(res, {
          description: 'LLM inference math API. Pass ?model=<name> plus parameters.',
          models: {
            singleTurn: { params: ['promptTokens', 'outputTokens', 'prefillSpeed', 'decodeSpeed'], example: '/api/compute?model=singleTurn&promptTokens=4096&outputTokens=512&prefillSpeed=3800&decodeSpeed=105' },
            speculative: { params: ['baseDecodeSpeed', 'draftTokens', 'acceptanceRate', 'draftCostFraction'], example: '/api/compute?model=speculative&baseDecodeSpeed=105&draftTokens=4&acceptanceRate=0.7' },
            batched: { params: ['prefillSpeed', 'decodeSpeed', 'batchSize', 'promptTokens', 'outputTokens', 'decodeDecayExponent'], example: '/api/compute?model=batched&batchSize=16&decodeSpeed=105' },
            agentic: { params: ['numTurns', 'basePromptTokens', 'toolOutputTokensPerTurn', 'decodeTokensPerTurn', 'prefillSpeed', 'decodeSpeed', 'enablePrefixCaching'], example: '/api/compute?model=agentic&numTurns=6&enablePrefixCaching=true' },
            kvCache: { params: ['architecture|numLayers+kvHeads+headDim', 'contextLength', 'precisionBytes', 'batchSize'], architectures: Object.keys(MODEL_PRESETS), example: '/api/compute?model=kvCache&architecture=llama70b&contextLength=65536' }
          },
          otherEndpoints: ['/api/presets', '/api/localmaxxing', '/llms.txt']
        });

      default:
        return json(res, { error: `Unknown model '${model}'`, available: ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache'] }, 400);
    }
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 500);
  }
}
