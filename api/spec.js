import { enforceRateLimit } from './_ratelimit.js';

export const config = { runtime: 'nodejs' };

const BASE = 'https://llm-prefill-decode-visualizer.vercel.app';

// Shared rate-limit documentation (issue #14). Budget: RATE_LIMIT per
// RATE_WINDOW_MS — see api/_ratelimit.js; keep in sync with /llms.txt.
const RATE_LIMIT_HEADERS = {
  'X-RateLimit-Limit': { description: 'Max requests per 60s window per client (best-effort, per serverless instance).', schema: { type: 'integer', example: 120 } },
  'X-RateLimit-Remaining': { description: 'Requests left in the current window.', schema: { type: 'integer' } },
  'X-RateLimit-Reset': { description: 'Unix epoch seconds when the current window resets.', schema: { type: 'integer' } }
};
const RATE_LIMITED_RESPONSE = {
  description: 'Rate limit exhausted for this window. Back off for Retry-After seconds, then resume.',
  headers: {
    ...RATE_LIMIT_HEADERS,
    'Retry-After': { description: 'Seconds until the window resets and requests are accepted again.', schema: { type: 'integer' } }
  },
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          limit: { type: 'integer' },
          remaining: { type: 'integer' },
          reset: { type: 'integer', description: 'Unix epoch seconds' },
          retryAfterSeconds: { type: 'integer' }
        }
      }
    }
  }
};

export default function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'LLM Prefill & Decode Speed Visualizer API',
      version: '2.3.0',
      description: 'LLM inference performance math and community-measured hardware benchmarks. All endpoints return JSON, support CORS, require no auth. Human docs at /llms.txt. Rate limited to 120 requests/min per client (best-effort, per serverless instance); every response carries X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset, and exhaustion returns 429 with Retry-After. Benchmark endpoints (/api/localmaxxing, /api/benchmarks, /api/best) carry a machine-readable top-level `caveats` array (objects with code/severity/summary/detail) describing dataset limitations.'
    },
    servers: [{ url: BASE }],
    paths: {
      '/api/compute': {
        get: {
          summary: 'Run inference math (TTFT, TPOT, walltime, VRAM)',
          description: 'Pass ?model=<name> plus parameters. Omit model for a self-describing capability list. Also accepts POST with a JSON body, or a batch of up to 50 parameter sets via POST {"batch": [...]} / GET ?batch=[...] — returns per-index results with per-item ok/error status.',
          parameters: [
            { name: 'model', in: 'query', schema: { type: 'string', enum: ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache', 'flagged', 'cost'] } },
            { name: 'promptTokens', in: 'query', schema: { type: 'number' }, description: 'singleTurn/batched/agentic/cost' },
            { name: 'outputTokens', in: 'query', schema: { type: 'number' }, description: 'singleTurn/batched/agentic/cost' },
            { name: 'prefillSpeed', in: 'query', schema: { type: 'number' }, description: 'tok/s' },
            { name: 'decodeSpeed', in: 'query', schema: { type: 'number' }, description: 'tok/s' },
            { name: 'numTurns', in: 'query', schema: { type: 'integer' }, description: 'agentic' },
            { name: 'enablePrefixCaching', in: 'query', schema: { type: 'boolean' }, description: 'agentic' },
            { name: 'batchSize', in: 'query', schema: { type: 'integer' }, description: 'batched/kvCache' },
            { name: 'draftTokens', in: 'query', schema: { type: 'integer' }, description: 'speculative: draft tokens per step' },
            { name: 'acceptanceRate', in: 'query', schema: { type: 'number' }, description: 'speculative: 0..1. Response includes breakevenAcceptanceRate — below it speculation is slower than vanilla decode.' },
            { name: 'hardwarePriceUsd', in: 'query', schema: { type: 'number' }, description: 'cost: purchase price, amortized over amortizationMonths (default 36)' },
            { name: 'electricityRatePerKwh', in: 'query', schema: { type: 'number' }, description: 'cost: $/kWh, default 0.15' },
            { name: 'powerDrawWatts', in: 'query', schema: { type: 'number' }, description: 'cost: whole-rig wall power under load' },
            { name: 'amortizationMonths', in: 'query', schema: { type: 'number' }, description: 'cost: months to spread hardware price over, default 36' },
            { name: 'architecture', in: 'query', schema: { type: 'string', enum: ['llama70b', 'llama8b', 'qwen72b', 'mistral7b'] }, description: 'kvCache preset arch' },
            { name: 'contextLength', in: 'query', schema: { type: 'integer' }, description: 'kvCache' },
            { name: 'precisionBytes', in: 'query', schema: { type: 'number', enum: [2, 1, 0.5] }, description: 'kvCache: FP16/FP8/INT4' },
            { name: 'flags', in: 'query', schema: { type: 'string' }, description: 'flagged: comma-separated engine flag ids (flash-attn,kv-q8,kv-q4,no-mmap,vllm-fp8-kv,vllm-o3). Documented heuristic deltas; response carries a per-flag audit trail.' }
          ],
          responses: { '200': { description: 'Computed metrics object' } },
          '429': { $ref: '#/components/responses/RateLimited' }
        }
      },
      '/api/vram': {
        get: {
          summary: 'Combined model + KV-cache + context VRAM from just an hfId',
          description: 'Resolves layers, hidden dim, GQA heads, head dim and weight size from the Hugging Face config automatically — no architecture params needed. Answers "will this rig OOM at 64k?". Optional vramGb budget returns a fits flag plus the max context that fits; optional numTurns+tokensPerTurn projects per-turn KV growth with the exact overflow turn.',
          parameters: [
            { name: 'hfId', in: 'query', required: true, schema: { type: 'string' }, description: 'Hugging Face repo id or URL, e.g. meta-llama/Llama-3.1-8B-Instruct' },
            { name: 'context', in: 'query', schema: { type: 'integer', default: 32768 }, description: 'context length in tokens' },
            { name: 'quant', in: 'query', schema: { type: 'string', default: 'q4_k_m' }, description: 'quant tag (fp16, q8_0, q6_k, q5_k_m, q4_k_m, q4_0, q3_k_m, q2_k, fp8, …); unknown tags assume ~4.85 bpw and are flagged' },
            { name: 'batchSize', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'kvPrecisionBytes', in: 'query', schema: { type: 'number', default: 2 }, description: 'KV cache precision: 2=FP16, 1=FP8, 0.5=INT4' },
            { name: 'vramGb', in: 'query', schema: { type: 'number' }, description: 'optional VRAM budget → fits flag + maxContextTokens (upper bound)' },
            { name: 'numTurns', in: 'query', schema: { type: 'integer' }, description: 'with tokensPerTurn: project KV growth over N agentic turns' },
            { name: 'tokensPerTurn', in: 'query', schema: { type: 'number' }, description: 'tokens added to context per turn' }
          ],
          responses: { '200': { description: 'Resolved model + weights/kv/total VRAM breakdown' }, '400': { description: 'Missing hfId' }, '404': { description: 'Unknown hfId on huggingface.co' }, '422': { description: 'config.json lacks required architecture fields' } }
        }
      },
      '/api/presets': {
        get: {
          summary: 'Built-in hardware speed presets and workload scenarios',
          responses: { '200': { description: '{hardware[], scenarios[]}' } },
          '429': { $ref: '#/components/responses/RateLimited' }
        }
      },
      '/api/localmaxxing': {
        get: {
          summary: 'Raw community benchmark runs (flattened, model-normalized)',
          description: 'Bare call returns a hardware-group summary. With any filter, returns a cursor-paginated run list: { total, items[], has_more, next_cursor } sorted by decode speed desc (runId tiebreak) — follow next_cursor until has_more is false.',
          parameters: [
            { name: 'hardware', in: 'query', schema: { type: 'string' }, description: 'substring match on rig name/key' },
            { name: 'model', in: 'query', schema: { type: 'string' }, description: 'substring match on normalized family or hfId' },
            { name: 'quant', in: 'query', schema: { type: 'string' }, description: 'exact quantization, e.g. q4_k_m' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 500 }, description: 'page size' },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'opaque next_cursor from the previous page (keyset resumption; stable across upstream inserts)' }
          ],
          responses: { '200': { description: 'Hardware summary, or paginated run list { total, items[], has_more, next_cursor }; both carry a machine-readable `caveats` array (single-stream-only, self-reported data, engine mix)' }, '429': { $ref: '#/components/responses/RateLimited' } }
        }
      },
      '/api/benchmarks': {
        get: {
          summary: 'Aggregated speeds: median + IQR per group',
          description: 'Outlier-resistant stats per hardware×model-family group (default). Regroup with ?groupBy=hardware|model|quant. Cursor-paginated: { total, items[], has_more, next_cursor } sorted by median decode desc (group key tiebreak).',
          parameters: [
            { name: 'groupBy', in: 'query', schema: { type: 'string', enum: ['hardwareModel', 'hardware', 'model', 'quant'] } },
            { name: 'hardware', in: 'query', schema: { type: 'string' } },
            { name: 'model', in: 'query', schema: { type: 'string' } },
            { name: 'quant', in: 'query', schema: { type: 'string' } },
            { name: 'hwClass', in: 'query', schema: { type: 'string', enum: ['discrete_gpu', 'unified', 'cpu_only'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 200 }, description: 'page size' },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'opaque next_cursor from the previous page (keyset resumption; stable across upstream inserts)' }
          ],
          responses: { '200': { description: 'Paginated groups { total, items[], has_more, next_cursor }; items carry median/q1/q3/min/max prefill & decode, plus bestRun. Top-level and per-group `caveats` arrays flag n=1 groups and mixed engine versions.' }, '429': { $ref: '#/components/responses/RateLimited' } }
        }
      },
      '/api/best': {
        get: {
          summary: 'Ranked answers: fastest or cheapest rigs for given constraints',
          description: 'Example: /api/best?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M by median decode speed. by=cost ranks by cost-efficiency instead.',
          parameters: [
            { name: 'by', in: 'query', schema: { type: 'string', enum: ['decode', 'prefill', 'cost'], default: 'decode' } },
            { name: 'price', in: 'query', schema: { type: 'number' }, description: 'cost mode: rig purchase price in USD (default 0)' },
            { name: 'electricityRate', in: 'query', schema: { type: 'number' }, description: 'cost mode: $/kWh (default 0.15)' },
            { name: 'powerWatts', in: 'query', schema: { type: 'number' }, description: 'cost mode: whole-rig watts; defaults to an estimate per hwClass' },
            { name: 'amortizationMonths', in: 'query', schema: { type: 'number' }, description: 'cost mode: spread price over this many months (default 36)' },
            { name: 'promptTokens', in: 'query', schema: { type: 'number' }, description: 'cost mode: scenario shape (default 2048)' },
            { name: 'outputTokens', in: 'query', schema: { type: 'number' }, description: 'cost mode: scenario shape (default 512)' },
            { name: 'model', in: 'query', schema: { type: 'string' } },
            { name: 'maxParamsB', in: 'query', schema: { type: 'number' }, description: 'only models at or under this size' },
            { name: 'quant', in: 'query', schema: { type: 'string' } },
            { name: 'hwClass', in: 'query', schema: { type: 'string', enum: ['discrete_gpu', 'unified', 'cpu_only'] } },
            { name: 'hardware', in: 'query', schema: { type: 'string' } },
            { name: 'fitCheck', in: 'query', schema: { type: 'boolean' }, description: 'exclude rigs whose memory cannot hold the model at the given context (estimated)' },
            { name: 'contextLength', in: 'query', schema: { type: 'integer', default: 32768 }, description: 'context for fitCheck; providing it implies fitCheck=true' },
            { name: 'precisionBytes', in: 'query', schema: { type: 'number', default: 2 }, description: 'KV cache dtype bytes for fitCheck (2 = fp16)' },
            { name: 'batchSize', in: 'query', schema: { type: 'integer', default: 1 }, description: 'batch size for fitCheck KV cache math' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }
          ],
          responses: { '200': { description: 'Ranked groups with medians, per-row `caveats` (n=1, mixed engines) and a top-level `caveats` array, plus source links; with fitCheck, each result carries an estimated vramFit breakdown and the response reports excludedRuns' }, '429': { $ref: '#/components/responses/RateLimited' } }
        }
      },
      '/api/health': {
        get: {
          summary: 'Service health and upstream data freshness',
          description: 'Liveness probe. Returns ok plus upstreamFreshness (fresh/stale/empty, last sync time, cached row count) and cacheAge in seconds. Human status page at /status.html.',
          responses: {
            '200': { description: '{ok, service, time, upstreamFreshness, cacheAge}' },
            '500': { description: 'Health handler itself failed' }
          }
        }
      },
      '/api/sizing': {
        get: {
          summary: 'Hardware sizing recommendation for a workload spec (VRAM fit + expected TTFT/TPOT)',
          description: 'One canonical query for deployment planning: pass a workload spec, get ranked rigs with required-VRAM math (weights + KV cache at target context × concurrency + overhead) and expected TTFT/TPOT from aggregated benchmark medians, plus per-group sample confidence.',
          parameters: [
            { name: 'model', in: 'query', required: true, schema: { type: 'string' }, description: 'model family / hfId substring, e.g. qwen' },
            { name: 'contextLength', in: 'query', schema: { type: 'integer', default: 8192 }, description: 'target context per request (drives KV-cache VRAM)' },
            { name: 'concurrency', in: 'query', schema: { type: 'integer', default: 1 }, description: 'simultaneous requests; scales KV cache, decays per-user decode ~B^-0.25' },
            { name: 'promptTokens', in: 'query', schema: { type: 'integer', default: 2048 }, description: 'tokens prefilled per request (TTFT input)' },
            { name: 'outputTokens', in: 'query', schema: { type: 'integer', default: 512 }, description: 'tokens decoded per request' },
            { name: 'maxTtftSeconds', in: 'query', schema: { type: 'number' }, description: 'SLO cap on expected TTFT' },
            { name: 'maxTpotMs', in: 'query', schema: { type: 'number' }, description: 'SLO cap on expected TPOT' },
            { name: 'maxVramGb', in: 'query', schema: { type: 'number' }, description: 'budget cap: rig memory (VRAM or unified) must fit under this' },
            { name: 'numLayers', in: 'query', schema: { type: 'integer' }, description: 'explicit KV arch (with kvHeads+headDim skips the per-param-count estimate)' },
            { name: 'kvHeads', in: 'query', schema: { type: 'integer' } },
            { name: 'headDim', in: 'query', schema: { type: 'integer' } },
            { name: 'quant', in: 'query', schema: { type: 'string' }, description: 'exact quantization match' },
            { name: 'hwClass', in: 'query', schema: { type: 'string', enum: ['discrete_gpu', 'unified', 'cpu_only'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 5, maximum: 25 } }
          ],
          responses: { '200': { description: 'workload echo, assumptions, and ranked recommendations with vramFit, expected, confidence, meetsSlo' } }

        }
      }
    },
    components: {
      headers: RATE_LIMIT_HEADERS,
      responses: { RateLimited: RATE_LIMITED_RESPONSE }
    }
  };

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(JSON.stringify(spec, null, 2));
}
