export const config = { runtime: 'nodejs' };

const BASE = 'https://llm-prefill-decode-visualizer.vercel.app';

export default function handler(req, res) {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'LLM Prefill & Decode Speed Visualizer API',
      version: '2.0.0',
      description: 'LLM inference performance math and community-measured hardware benchmarks. All endpoints return JSON, support CORS, require no auth. Human docs at /llms.txt.'
    },
    servers: [{ url: BASE }],
    paths: {
      '/api/compute': {
        get: {
          summary: 'Run inference math (TTFT, TPOT, walltime, VRAM)',
          description: 'Pass ?model=<name> plus parameters. Omit model for a self-describing capability list. Also accepts POST with a JSON body, or a batch of up to 50 parameter sets via POST {"batch": [...]} / GET ?batch=[...] — returns per-index results with per-item ok/error status.',
          parameters: [
            { name: 'model', in: 'query', schema: { type: 'string', enum: ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache'] } },
            { name: 'promptTokens', in: 'query', schema: { type: 'number' }, description: 'singleTurn/batched/agentic' },
            { name: 'outputTokens', in: 'query', schema: { type: 'number' }, description: 'singleTurn/batched/agentic' },
            { name: 'prefillSpeed', in: 'query', schema: { type: 'number' }, description: 'tok/s' },
            { name: 'decodeSpeed', in: 'query', schema: { type: 'number' }, description: 'tok/s' },
            { name: 'numTurns', in: 'query', schema: { type: 'integer' }, description: 'agentic' },
            { name: 'enablePrefixCaching', in: 'query', schema: { type: 'boolean' }, description: 'agentic' },
            { name: 'batchSize', in: 'query', schema: { type: 'integer' }, description: 'batched/kvCache' },
            { name: 'draftTokens', in: 'query', schema: { type: 'integer' }, description: 'speculative: draft tokens per step' },
            { name: 'acceptanceRate', in: 'query', schema: { type: 'number' }, description: 'speculative: 0..1. Response includes breakevenAcceptanceRate — below it speculation is slower than vanilla decode.' },
            { name: 'architecture', in: 'query', schema: { type: 'string', enum: ['llama70b', 'llama8b', 'qwen72b', 'mistral7b'] }, description: 'kvCache preset arch' },
            { name: 'contextLength', in: 'query', schema: { type: 'integer' }, description: 'kvCache' },
            { name: 'precisionBytes', in: 'query', schema: { type: 'number', enum: [2, 1, 0.5] }, description: 'kvCache: FP16/FP8/INT4' }
          ],
          responses: { '200': { description: 'Computed metrics object' } }
        }
      },
      '/api/presets': {
        get: {
          summary: 'Built-in hardware speed presets and workload scenarios',
          responses: { '200': { description: '{hardware[], scenarios[]}' } }
        }
      },
      '/api/localmaxxing': {
        get: {
          summary: 'Raw community benchmark runs (flattened, model-normalized)',
          description: 'Bare call returns a hardware-group summary. Filters: ?hardware=<substr>&model=<substr>&quant=<exact>&limit=N. Runs carry measured prefillTokPerSec / decodeTokPerSec.',
          parameters: [
            { name: 'hardware', in: 'query', schema: { type: 'string' }, description: 'substring match on rig name/key' },
            { name: 'model', in: 'query', schema: { type: 'string' }, description: 'substring match on normalized family or hfId' },
            { name: 'quant', in: 'query', schema: { type: 'string' }, description: 'exact quantization, e.g. q4_k_m' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 500 } }
          ],
          responses: { '200': { description: 'Hardware summary or run list' } }
        }
      },
      '/api/benchmarks': {
        get: {
          summary: 'Aggregated speeds: median + IQR per group',
          description: 'Outlier-resistant stats per hardware×model-family group (default). Regroup with ?groupBy=hardware|model|quant.',
          parameters: [
            { name: 'groupBy', in: 'query', schema: { type: 'string', enum: ['hardwareModel', 'hardware', 'model', 'quant'] } },
            { name: 'hardware', in: 'query', schema: { type: 'string' } },
            { name: 'model', in: 'query', schema: { type: 'string' } },
            { name: 'quant', in: 'query', schema: { type: 'string' } },
            { name: 'hwClass', in: 'query', schema: { type: 'string', enum: ['discrete_gpu', 'unified', 'cpu_only'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25 } }
          ],
          responses: { '200': { description: 'Groups with median/q1/q3/min/max prefill & decode, plus bestRun' } }
        }
      },
      '/api/best': {
        get: {
          summary: 'Ranked answers: fastest rigs for given constraints',
          description: 'Example: /api/best?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M by median decode speed.',
          parameters: [
            { name: 'by', in: 'query', schema: { type: 'string', enum: ['decode', 'prefill'], default: 'decode' } },
            { name: 'model', in: 'query', schema: { type: 'string' } },
            { name: 'maxParamsB', in: 'query', schema: { type: 'number' }, description: 'only models at or under this size' },
            { name: 'quant', in: 'query', schema: { type: 'string' } },
            { name: 'hwClass', in: 'query', schema: { type: 'string', enum: ['discrete_gpu', 'unified', 'cpu_only'] } },
            { name: 'hardware', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }
          ],
          responses: { '200': { description: 'Ranked groups with medians and source links' } }
        }
      }
    }
  };

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(JSON.stringify(spec, null, 2));
}
