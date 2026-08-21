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
            { name: 'model', in: 'query', schema: { type: 'string', enum: ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache', 'flagged'] } },
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
            { name: 'precisionBytes', in: 'query', schema: { type: 'number', enum: [2, 1, 0.5] }, description: 'kvCache: FP16/FP8/INT4' },
            { name: 'flags', in: 'query', schema: { type: 'string' }, description: 'flagged: comma-separated engine flag ids (flash-attn,kv-q8,kv-q4,no-mmap,vllm-fp8-kv,vllm-o3). Documented heuristic deltas; response carries a per-flag audit trail.' }
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
          description: 'Bare call returns a hardware-group summary. With any filter, returns a cursor-paginated run list: { total, items[], has_more, next_cursor } sorted by decode speed desc (runId tiebreak) — follow next_cursor until has_more is false.',
          parameters: [
            { name: 'hardware', in: 'query', schema: { type: 'string' }, description: 'substring match on rig name/key' },
            { name: 'model', in: 'query', schema: { type: 'string' }, description: 'substring match on normalized family or hfId' },
            { name: 'quant', in: 'query', schema: { type: 'string' }, description: 'exact quantization, e.g. q4_k_m' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 500 }, description: 'page size' },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'opaque next_cursor from the previous page (keyset resumption; stable across upstream inserts)' }
          ],
          responses: { '200': { description: 'Hardware summary, or paginated run list { total, items[], has_more, next_cursor }' } }
        },
        post: {
          summary: 'Submit a community benchmark run for review',
          description: 'Validates required fields (model, quant, hardware, hwClass, prefillTokPerSec, decodeTokPerSec), applies per-hardware-class sanity bounds (e.g. rejects 99,999 tok/s claimed on an RPi5), and checks for duplicates against existing runs. Accepted submissions are queued for manual review — never published immediately. Optional: engine, promptTokens, outputTokens, contextLength, provenance {engineVersion, command, sourceUrl, notes}, submitter.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['model', 'quant', 'hardware', 'hwClass', 'prefillTokPerSec', 'decodeTokPerSec'],
                  properties: {
                    model: { type: 'string', description: 'HF id or family name, e.g. unsloth/Qwen3.6-27B-GGUF' },
                    quant: { type: 'string', example: 'Q4_K_M' },
                    hardware: { type: 'string', description: 'rig description, e.g. Raspberry Pi 5 (16GB)' },
                    hwClass: { type: 'string', enum: ['discrete_gpu', 'unified', 'cpu_only'] },
                    prefillTokPerSec: { type: 'number' },
                    decodeTokPerSec: { type: 'number' },
                    engine: { type: 'string', example: 'llama.cpp' },
                    promptTokens: { type: 'integer' },
                    outputTokens: { type: 'integer' },
                    contextLength: { type: 'integer' },
                    provenance: {
                      type: 'object',
                      properties: {
                        engineVersion: { type: 'string', example: 'llama.cpp b6242' },
                        command: { type: 'string', example: 'llama-bench -m model.gguf -p 512 -n 128' },
                        sourceUrl: { type: 'string' },
                        notes: { type: 'string' }
                      }
                    },
                    submitter: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '202': { description: 'Queued for review — returns submissionId + status "queued"' },
            '400': { description: 'Validation failed — machine-readable errors array [{field, code, message}]' },
            '409': { description: 'Duplicate run — near-identical run already exists (error: duplicate_run)' }
          }
        }
      },
      '/api/diff': {
        get: {
          summary: 'Diff two measured runs: deltas, ratios and a plain-language summary',
          description: 'Returns both runs plus per-metric comparison. delta = B − A, ratio = B ÷ A, winner is from A\'s point of view. Time metrics (ttft/tpot/walltime) are normalized to a 2048-token prompt / 512-token output so runs measured at different lengths stay comparable.',
          parameters: [
            { name: 'runA', in: 'query', required: true, schema: { type: 'string' }, description: 'first run id (alias: a)' },
            { name: 'runB', in: 'query', required: true, schema: { type: 'string' }, description: 'second run id (alias: b)' }
          ],
          responses: {
            '200': { description: '{ runA, runB, diff: { context, metrics: { prefill, decode, ttft, tpot, walltime }, summary } }' },
            '400': { description: 'missing or identical run ids' },
            '404': { description: 'unknown run id' }
          }
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
          responses: { '200': { description: 'Paginated groups { total, items[], has_more, next_cursor }; items carry median/q1/q3/min/max prefill & decode, plus bestRun' } }
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
            { name: 'fitCheck', in: 'query', schema: { type: 'boolean' }, description: 'exclude rigs whose memory cannot hold the model at the given context (estimated)' },
            { name: 'contextLength', in: 'query', schema: { type: 'integer', default: 32768 }, description: 'context for fitCheck; providing it implies fitCheck=true' },
            { name: 'precisionBytes', in: 'query', schema: { type: 'number', default: 2 }, description: 'KV cache dtype bytes for fitCheck (2 = fp16)' },
            { name: 'batchSize', in: 'query', schema: { type: 'integer', default: 1 }, description: 'batch size for fitCheck KV cache math' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }
          ],
          responses: { '200': { description: 'Ranked groups with medians and source links; with fitCheck, each result carries an estimated vramFit breakdown and the response reports excludedRuns' } }
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
      }
    }
  };

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(JSON.stringify(spec, null, 2));
}
