import { enforceRateLimit } from '../_ratelimit.js';
import { ERROR_CODES, problemType } from '../_errors.js';

export const config = { runtime: 'nodejs' };

import { sendJson } from '../_schema.js';

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

// Shared by /api/localmaxxing, /api/benchmarks and /api/best: pin a
// versioned dataset snapshot (see /api/snapshots) for reproducible results.
const SNAPSHOT_PARAM = {
  name: 'snapshot', in: 'query', schema: { type: 'string' },
  description: 'Serve the pinned dataset snapshot instead of live data. IDs from /api/snapshots; unknown IDs fall back to current data with snapshot.served=false.'
};

// Shared error responses (RFC 9457 problem+json), from _errors.js (#16).
const PROBLEM = { $ref: '#/components/schemas/Problem' };
const RATE_LIMITED = { description: 'Rate limited (code RATE_LIMITED)', content: { 'application/problem+json': { schema: PROBLEM } } };

const COMPUTE_ERRORS = {
  '400': { description: 'Invalid parameters (code INVALID_PARAMS)', content: { 'application/problem+json': { schema: PROBLEM } } },
  '429': RATE_LIMITED,
  '500': { description: 'Internal server error (code INTERNAL)', content: { 'application/problem+json': { schema: PROBLEM } } }
};

const DATA_ERRORS = {
  '429': RATE_LIMITED,
  '502': { description: 'Upstream benchmark source unavailable (code UPSTREAM_UNAVAILABLE) — transient, safe to retry with backoff', content: { 'application/problem+json': { schema: PROBLEM } } }
};

export default function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'LLM Prefill & Decode Speed Visualizer API',
      version: '2.6.0',
      description: 'LLM inference performance math and community-measured hardware benchmarks. All endpoints return JSON, support CORS, require no auth. URL versioning: every endpoint is also served under the /v1/ prefix (e.g. /v1/compute) — external consumers should harden onto /v1/; the unversioned /api/ paths keep working and remain the canonical docs location (/api/spec). Breaking changes will ship under a new version prefix with the previous one kept for at least 90 days (see CHANGELOG-API.md). Every response body carries a schema_version field ("1") and every response sets an X-Schema-Version header; see CHANGELOG-API.md for the versioning + deprecation policy. Human docs at /llms.txt. Rate limited to 120 requests/min per client (best-effort, per serverless instance); every response carries X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset, and exhaustion returns 429 with Retry-After. Benchmark endpoints (/api/localmaxxing, /api/benchmarks, /api/best) carry a machine-readable top-level `caveats` array (objects with code/severity/summary/detail) describing dataset limitations, and each aggregate carries a confidence block plus crossCheck. Errors follow RFC 9457 problem+json with a stable machine-readable code — see x-error-codes.'
    },
    servers: [
      { url: BASE, description: 'Canonical unversioned host — /api/* paths' },
      { url: BASE + '/v1', description: 'Versioned prefix (/v1/compute, /v1/benchmarks, …) — preferred for external consumers; maps 1:1 onto the /api/* paths' }
    ],
    paths: {
      '/api/compute': {
        get: {
          summary: 'Run inference math (TTFT, TPOT, walltime, VRAM)',
          description: 'Pass ?model=<name> plus parameters. Omit model for a self-describing capability list. Also accepts POST with a JSON body, or a batch of up to 50 parameter sets via POST {"batch": [...]} / GET ?batch=[...] — returns per-index results with per-item ok/error status. Every computation response carries a deterministic `id` (calc_<hash> of the resolved inputs) that can be replayed via /api/calc/{id}.',
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
            { name: 'flags', in: 'query', schema: { type: 'string' }, description: 'flagged: comma-separated engine flag ids (flash-attn,kv-q8,kv-q4,no-mmap,vllm-fp8-kv,vllm-o3). Documented heuristic deltas; response carries a per-flag audit trail.' },
            { name: 'dry_run', in: 'query', schema: { type: 'boolean' }, description: 'Validate + echo parsed params (defaults filled in) without executing any math. Returns { dry_run: true, model, inputs, id?, note }; the id matches the real call. Also applies per-item inside a batch via "dry_run": true in the POST body.' }
          ],
          responses: {
            '200': {
              description: 'Computed metrics object',
              content: {
                'application/json': {
                  example: {
                    id: 'calc_9536a8f7358a',
                    inputs: { promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 },
                    warnings: [],
                    ttftSeconds: 1.077895,
                    tpotMs: 9.52381,
                    decodeSeconds: 4.87619,
                    totalWalltimeSeconds: 5.954085,
                    effectiveThroughputTokPerSec: 773.922414,
                    prefillSharePct: 18.103448,
                    decodeSharePct: 81.896552,
                    schema_version: '1'
                  }
                }
              }
            },
            '400': { description: 'Invalid parameters (code INVALID_PARAMS)', content: { 'application/problem+json': { schema: PROBLEM } } }, '500': { description: 'Internal server error (code INTERNAL)', content: { 'application/problem+json': { schema: PROBLEM } } }
          },
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
      '/api/calc/{id}': {
        get: {
          summary: 'Replay a computation or recommendation from its deterministic id',
          description: 'Ids are content hashes (calc_ + 12 hex chars of sha256 over the normalized request) returned as `id` by /api/compute and /api/best. They are not stored anywhere: re-send the original parameters alongside the id and this endpoint re-runs the same math and returns the result with verified:true. A mismatching parameter set is rejected with the expected id.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^calc_[0-9a-f]{12}$' } },
            { name: 'endpoint', in: 'query', schema: { type: 'string', enum: ['compute', 'best'], default: 'compute' } },
            { name: '<original request parameters>', in: 'query', description: 'The same model + params (or best filters) that minted the id. Defaults may be omitted — they resolve identically before hashing.' }
          ],
          responses: {
            '200': { description: 'Recomputed result, stamped verified:true and carrying the id' },
            '400': { description: 'Malformed id, missing replay parameters, or id/parameter mismatch (body.expected carries the correct id)' }
          }
        }
      },
      '/api/presets': {
        get: {
          summary: 'Built-in hardware speed presets and workload scenarios',
          responses: {
            '200': {
              description: '{hardware[], scenarios[]}; each hardware entry carries power/thermal guidance (#69): tdpWatts (board power), loadWatts (typical whole-rig wattage under inference), psuWatts (recommended PSU size) and powerNote — null where not applicable (cloud/edge/custom).',
              content: {
                'application/json': {
                  example: {
                    description: 'Built-in hardware speed presets and workload scenario presets. Use these values as inputs to /api/compute.',
                    hardware: [
                      { id: 'rtx4090_exl2', name: 'RTX 4090 24GB (ExLlamaV2 EXL2)', prefillSpeedTokPerSec: 3800, decodeSpeedTokPerSec: 105, vramBandwidth: '1.01 TB/s (GDDR6X)', badge: 'Localmaxxing #1 Consumer' },
                      { id: 'dual_rtx3090', name: 'Dual RTX 3090 48GB (TP2 ExLlamaV2 70B)', prefillSpeedTokPerSec: 4600, decodeSpeedTokPerSec: 78, vramBandwidth: '1.87 TB/s Combined', badge: 'Localmaxxing 70B Rig' },
                      { id: 'rtx3090_llamacpp', name: 'RTX 3090 24GB (llama.cpp Q4_K_M)', prefillSpeedTokPerSec: 2400, decodeSpeedTokPerSec: 65, vramBandwidth: '936 GB/s (GDDR6X)', badge: 'Localmaxxing Budget King' }
                    ],
                    scenarios: [
                      { id: 'chat', label: 'Standard chat', promptTokens: 2048, outputTokens: 512 },
                      { id: 'rag', label: 'RAG query', promptTokens: 4096, outputTokens: 512 }
                    ],
                    schema_version: '1'
                  }
                }
              }
            },
            '429': { $ref: '#/components/responses/RateLimited' }
          }
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
            { name: 'context_band', in: 'query', schema: { type: 'string', enum: ['lt1k', '1k-8k', '8k-32k', '32k+'] }, description: 'only runs measured at this context length (<1000, 1000–7999, 8000–31999, ≥32000 tokens)' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 500 }, description: 'page size' },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'opaque next_cursor from the previous page (keyset resumption; stable across upstream inserts)' },
            SNAPSHOT_PARAM
          ],
          responses: {
            '200': {
              description: 'Hardware summary, or paginated run list { total, items[], has_more, next_cursor }; both carry a machine-readable `caveats` array (single-stream-only, self-reported data, engine mix)',
              content: {
                'application/json': {
                  example: {
                    description: 'Raw comparable runs (modelFamily collapses repo/quant variants of the same base model). Cursor pagination: follow next_cursor until has_more is false.',
                    snapshot: { id: 'snapshot-2026-08-21-a1b2c3d4', createdAt: '2026-08-21T09:14:03.000Z', runCount: 3642 },
                    snapshotAt: '2026-08-21T09:14:03.512Z',
                    schema_version: '1',
                    total: 214,
                    caveats: [
                      { code: 'single_stream_only', severity: 'medium', summary: 'Dataset only contains batchSize=1 runs — not batched-serving throughput.', detail: 'All 3642 runs report concurrency ≤ 1.' },
                      { code: 'self_reported_unvalidated', severity: 'medium', summary: 'Community-submitted runs, not independently verified; trust medians over single runs.', detail: 'Submissions are sanity-bounded and deduplicated but not lab-measured.' }
                    ],
                    items: [
                      {
                        runId: 58213,
                        createdAt: '2026-07-30T18:22:41.000Z',
                        modelFamily: 'qwen3.6-27b',
                        modelName: 'unsloth/Qwen3.6-27B-MTP-GGUF',
                        hardwareKey: 'rtx4090',
                        hardware: 'RTX 4090 24GB',
                        hwClass: 'discrete_gpu',
                        gpu: 'RTX 4090',
                        gpuCount: 1,
                        engine: 'llama.cpp',
                        engineVersion: 'b6123',
                        quantization: 'q4_k_m',
                        prefillTokPerSec: 3820,
                        decodeTokPerSec: 108,
                        contextLength: 8192,
                        contextBand: '8k-32k',
                        ageDays: 23,
                        staleness: 'recent',
                        source: 'https://localmaxxing.com/en/runs/58213'
                      }
                    ],
                    has_more: true,
                    next_cursor: 'MTA4fCI1ODIxMyI'
                  }
                }
              }
            },
            '429': { $ref: '#/components/responses/RateLimited' }
          }
        }
      },
      '/api/watch': {
        get: {
          summary: 'Watch feeds: list registered hardware+model combos (#109)',
          description: 'Public listing of watched combos — never includes secrets or webhook URLs. POST to create a watch; DELETE ?id=&secret= to remove one.',
          responses: {
            '200': {
              description: 'Feature description + registered watches (watchId, label, hasWebhook, createdAt)',
              content: { 'application/json': { example: {
                description: 'Watch feeds (#109): subscribe to a hardware+model combination…',
                maxWatches: 500, totalWatches: 1,
                watches: [{ watchId: 'watch_abc123_x9', label: 'RTX 4090 + Qwen3 32B', model: 'Qwen3 32B', hardware: 'RTX 4090', quant: null, hasWebhook: false, createdAt: '2026-08-22T10:00:00.000Z' }]
              } } }
            },
            '429': { $ref: '#/components/responses/RateLimited' }
          }
        },
        post: {
          summary: 'Create a watch for a hardware+model combo (#109)',
          description: 'Body: { model?, hardware?, quant?, webhookUrl? } — at least one of model/hardware required; webhookUrl must be https. Returns 201 with watchId + secret (shown exactly once; required to DELETE, sent to your webhook as X-Watch-Secret) and a ready-made rssUrl. RSS polling needs no webhook: GET /api/watch/rss.xml?model=&hardware=&quant=.',
          requestBody: { required: true, content: { 'application/json': { example: { model: 'Qwen3 32B', hardware: 'RTX 4090', quant: 'q4_k_m', webhookUrl: 'https://example.com/hooks/llm-watch' } } } },
          responses: {
            '201': { description: 'Watch created (watchId, secret, rssUrl, matchingExistingRuns preview)' },
            '400': { description: 'Invalid body (code validation_failed with per-field errors)' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '503': { description: 'Watch store unavailable (code watch_store_unavailable)' }
          }
        },
        delete: {
          summary: 'Remove a watch',
          parameters: [
            { name: 'id', in: 'query', required: true, schema: { type: 'string' }, description: 'watchId from the POST response' },
            { name: 'secret', in: 'query', required: true, schema: { type: 'string' }, description: 'one-time secret from the POST response (also accepted as X-Watch-Secret header)' }
          ],
          responses: {
            '204': { description: 'Watch removed' },
            '403': { description: 'Wrong or missing secret (code invalid_secret)' },
            '404': { description: 'Unknown watchId (code watch_not_found)' }
          }
        }
      },
      '/api/watch/rss.xml': {
        get: {
          summary: 'RSS 2.0 feed of community runs for a watched combo (#109)',
          description: 'Filters mirror GET /api/localmaxxing (model/hardware substring, quant exact). Items are the newest matching runs (max 50), each linking to the upstream run. Poll like any feed — no registration needed.',
          parameters: [
            { name: 'model', in: 'query', schema: { type: 'string' }, description: 'substring match on normalized family / hfId / display name' },
            { name: 'hardware', in: 'query', schema: { type: 'string' }, description: 'substring match on rig name/key' },
            { name: 'quant', in: 'query', schema: { type: 'string' }, description: 'exact quantization' },
            { name: 'days', in: 'query', schema: { type: 'integer', default: 30, maximum: 365 }, description: 'only runs measured in the last N days (undated runs always included)' }
          ],
          responses: {
            '200': { description: 'RSS 2.0 XML (application/rss+xml); X-Matched-Runs header reports the pre-cap match count' },
            '429': { $ref: '#/components/responses/RateLimited' }
          }
        }
      },
      '/api/watch/dispatch': {
        get: {
          summary: 'Deliver unseen matching runs to registered webhooks (#109)',
          description: 'Cron-friendly (Vercel Cron sends GET). For each watch with a webhookUrl: POST a watch.new_runs payload (X-Watch-Secret header) with runs created after the watch that are not yet in its bounded seen-set, then persist the set. Set WATCH_DISPATCH_SECRET to require ?secret= / x-dispatch-secret. Delivery failures are reported per watch, never thrown.',
          responses: {
            '200': { description: '{ dispatched, totalNewRuns, results[], previewPayload }' },
            '401': { description: 'WATCH_DISPATCH_SECRET set and not provided (code unauthorized)' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '503': { description: 'Watch store unavailable (code watch_store_unavailable)' }
          }
        }
      },
      '/api/benchmarks': {
        get: {
          summary: 'Aggregated speeds: median + IQR + 95% bootstrap CI per group',
          description: 'Outlier-resistant stats per hardware×model-family group (default). Each median carries a 95% percentile bootstrap confidence interval (2,000 resamples) in ci95 {lo, hi}, plus a "median [lo–hi]" label string. Regroup with ?groupBy=hardware|model|quant. Cursor-paginated: { total, items[], has_more, next_cursor } sorted by median decode desc (group key tiebreak). Each group carries confidence {runs, iqrSpreadPct, outliers, newestRunAgeDays, grade} and cross_check {relatedRigComparisons, contradictions[]} comparing multi-GPU rigs against the single-GPU baseline on the same model/quant.',
          parameters: [
            { name: 'groupBy', in: 'query', schema: { type: 'string', enum: ['hardwareModel', 'hardware', 'model', 'quant'] } },
            { name: 'hardware', in: 'query', schema: { type: 'string' } },
            { name: 'model', in: 'query', schema: { type: 'string' } },
            { name: 'quant', in: 'query', schema: { type: 'string' } },
            { name: 'hwClass', in: 'query', schema: { type: 'string', enum: ['discrete_gpu', 'unified', 'cpu_only'] } },
            { name: 'context_band', in: 'query', schema: { type: 'string', enum: ['lt1k', '1k-8k', '8k-32k', '32k+'] }, description: 'only runs measured at this context length; groups mixing bands carry mixedContextBands + a warning' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 200 }, description: 'page size' },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'opaque next_cursor from the previous page (keyset resumption; stable across upstream inserts)' },
            SNAPSHOT_PARAM
          ],
          responses: {
            '200': {
              description: 'Paginated groups { total, items[], has_more, next_cursor }; items carry median/q1/q3/min/max prefill & decode with 95% bootstrap CIs on each median, bestRun, a confidence block and crossCheck. Top-level and per-group `caveats` arrays flag n=1 groups and mixed engine versions.',
              content: {
                'application/json': {
                  example: {
                    description: 'Aggregated community benchmark speeds (median + IQR + 95% bootstrap CI per group).',
                    snapshot: { id: 'snapshot-2026-08-21-a1b2c3d4', createdAt: '2026-08-21T09:14:03.000Z', runCount: 3642 },
                    snapshotAt: '2026-08-21T09:14:03.512Z',
                    schema_version: '1',
                    total: 187,
                    caveats: [
                      { code: 'n1_groups', severity: 'medium', summary: '22% of groups rest on a single run — treat as anecdotal.', detail: '18 of 82 returned groups have runs=1.', pct: 22, groupsWithOneRun: 18, totalGroups: 82 }
                    ],
                    items: [
                      {
                        key: 'rtx4090|qwen3.6-27b',
                        runs: 14,
                        prefill: { q1: 3601, median: 3800, q3: 3950, min: 3210, max: 4102, ci95: { lo: 3701, hi: 3902 }, label: '3800 [3701–3902]' },
                        decode: { q1: 99, median: 105, q3: 112, min: 88, max: 118, ci95: { lo: 101, hi: 110 }, label: '105 [101–110]' },
                        modelFamilies: ['qwen3.6-27b'],
                        engines: ['llama.cpp'],
                        mixedEngines: false,
                        caveats: [],
                        confidence: { runs: 14, iqrSpreadPct: 12.38, outliers: 0, newestRunAgeDays: 3, grade: 'high' },
                        crossCheck: { relatedRigComparisons: [], contradictions: [] },
                        bestRun: {
                          runId: 58213,
                          modelName: 'unsloth/Qwen3.6-27B-MTP-GGUF',
                          hardware: 'RTX 4090 24GB',
                          engine: 'llama.cpp',
                          engineVersion: 'b6123',
                          quantization: 'q4_k_m',
                          prefillTokPerSec: 3820,
                          decodeTokPerSec: 108,
                          createdAt: '2026-07-30T18:22:41.000Z',
                          source: 'https://localmaxxing.com/en/runs/58213'
                        }
                      }
                    ],
                    has_more: true,
                    next_cursor: 'MTA1fCJydDQwOTB8cXdlbjMuNi0yN2Ii'
                  }
                }
              }
            },
            '429': { $ref: '#/components/responses/RateLimited' }
          }
        }
      },
      '/api/best': {
        get: {
          summary: 'Ranked answers: fastest or cheapest rigs for given constraints',
          description: 'Example: /api/best?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M by median decode speed. by=cost ranks by cost-efficiency instead. Medians carry 95% bootstrap CIs (medianXxxCi95 / medianXxxLabel). Responses carry a deterministic `id` (hash of the resolved filters) replayable via /api/calc/{id}?endpoint=best&<same filters>.',
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
            { name: 'context_band', in: 'query', schema: { type: 'string', enum: ['lt1k', '1k-8k', '8k-32k', '32k+'] }, description: 'only runs measured at this context length (<1000, 1000–7999, 8000–31999, ≥32000 tokens)' },
            { name: 'fitCheck', in: 'query', schema: { type: 'boolean' }, description: 'exclude rigs whose memory cannot hold the model at the given context (estimated)' },
            { name: 'contextLength', in: 'query', schema: { type: 'integer', default: 32768 }, description: 'context for fitCheck; providing it implies fitCheck=true' },
            { name: 'precisionBytes', in: 'query', schema: { type: 'number', default: 2 }, description: 'KV cache dtype bytes for fitCheck (2 = fp16)' },
            { name: 'batchSize', in: 'query', schema: { type: 'integer', default: 1 }, description: 'batch size for fitCheck KV cache math' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
            SNAPSHOT_PARAM
          ],
          responses: {
            '200': {
              description: 'Ranked groups with medians, per-row `caveats` (n=1, mixed engines), a confidence block and a top-level `caveats` array, plus source links; with fitCheck, each result carries an estimated vramFit breakdown and the response reports excludedRuns. Each result includes a `pricing` object: USD street-price estimate with low/high range, perGpu breakdown for multi-GPU rigs, asOf date, and eBay (new + used) and Craigslist search links to verify against live listings. `pricing` is null when no anchor exists (cpu_only, unknown GPUs). Each result also carries `explain`: a one-sentence human-readable explanation combining the VRAM-fit math (weights + KV estimates) with the measured source, e.g. \'24GB fits 8B q4_k_m weights ~5GB + 32k KV ~4GB with 14GB headroom; measured 100 tok/s decode from run #a1\' — pass-through ready for agent chat pipelines. Each result also includes a `power` object (#69): board power (TDP, per card and total), typical whole-rig wattage under sustained inference, and a recommended PSU size with transient-headroom notes — so a dual-GPU recommendation can be sanity-checked against the user\'s actual electrical setup. `power` is null when no anchor exists (cpu_only, unknown GPUs).',
              content: {
                'application/json': {
                  example: {
                    id: 'calc_7f2c91b04da3',
                    description: 'Ranked hardware×model groups by measured community speed. Medians are outlier-resistant.',
                    rankedBy: 'decode',
                    snapshot: { id: 'snapshot-2026-08-21-a1b2c3d4', createdAt: '2026-08-21T09:14:03.000Z', runCount: 3642 },
                    snapshotAt: '2026-08-21T09:14:03.512Z',
                    matchedRuns: 214,
                    schema_version: '1',
                    caveats: [
                      { code: 'single_stream_only', severity: 'medium', summary: 'Dataset only contains batchSize=1 runs — not batched-serving throughput.', detail: 'All 3642 runs report concurrency ≤ 1.' }
                    ],
                    warnings: [],
                    results: [
                      {
                        hardware: 'RTX 4090 24GB',
                        hardwareKey: 'rtx4090',
                        hwClass: 'discrete_gpu',
                        gpu: 'RTX 4090',
                        gpuCount: 1,
                        vramGb: 24,
                        modelFamily: 'qwen3.6-27b',
                        exampleModel: 'unsloth/Qwen3.6-27B-MTP-GGUF',
                        quantization: 'q4_k_m',
                        engine: 'llama.cpp',
                        runsInGroup: 14,
                        confidence: { runs: 14, iqrSpreadPct: 12.38, outliers: 0, newestRunAgeDays: 3, grade: 'high' },
                        medianPrefillTokPerSec: 3800,
                        medianDecodeTokPerSec: 105,
                        bestDecodeTokPerSec: 118,
                        medianPrefillCi95: { lo: 3701, hi: 3902 },
                        medianPrefillLabel: '3800 [3701–3902]',
                        medianDecodeCi95: { lo: 101, hi: 110 },
                        medianDecodeLabel: '105 [101–110]',
                        caveats: [],
                        effectiveVramGb: 24,
                        pricing: {
                          estimateUsd: 1650,
                          lowUsd: 1400,
                          highUsd: 1900,
                          perGpu: [{ gpu: 'RTX 4090', estimateUsd: 1650 }],
                          asOf: '2026-08-01',
                          links: {
                            ebay: 'https://www.ebay.com/sch/i.html?_nkw=rtx+4090',
                            ebayUsed: 'https://www.ebay.com/sch/i.html?_nkw=rtx+4090&LH_ItemCondition=3000',
                            craigslist: 'https://craigslist.org/search/sss?query=rtx+4090'
                          }
                        },
                        explain: '24GB VRAM fits qwen3.6-27b q4_k_m weights ~16GB + 32k KV ~7GB with ~1GB headroom; measured 105 tok/s decode median across 14 community runs.'
                      }
                    ]
                  }
                }
              }
            },
            '429': { $ref: '#/components/responses/RateLimited' } }

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
          responses: { '200': { description: 'workload echo, assumptions, and ranked recommendations with vramFit, expected, confidence, meetsSlo, and a one-sentence human-readable `explain` string combining fit math with the measured source (#73)' } }

        }
      },
      '/api/parse-constraints': {
        get: {
          summary: 'Parse plain-language constraints into the canonical constraint JSON',
          description: 'Converts a natural-language constraint string (e.g. "self-hosted Qwen 27B at Q4 for 10 users under $1500") into the canonical constraint struct used by /api/sizing and /api/best. Deterministic regex/heuristics — no external LLM calls. Returns the echoed input, the parsed struct (null = not stated) and an `ambiguities` array listing every assumption (e.g. "10 users: assume 1 stream each or batched?"), plus a ready-made `sizingQuery` for the downstream decision endpoint.',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' }, description: 'Plain-language constraints, e.g. self-hosted Qwen 27B at Q4 for 10 users under $1500' }
          ],
          responses: {
            '200': {
              description: '{input, recognizedCount, constraints{deployment,modelFamily,paramsB,quantization,contextLength,concurrency,budgetUsdMax,minDecodeTokPerSec,maxVramGb,hwClass}, ambiguities[], sizingQuery}',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      input: { type: 'string' },
                      recognizedCount: { type: 'integer' },
                      constraints: {
                        type: 'object',
                        properties: {
                          deployment: { type: 'string', enum: ['self-hosted', 'cloud'], nullable: true },
                          modelFamily: { type: 'string', nullable: true },
                          paramsB: { type: 'number', nullable: true },
                          quantization: { type: 'string', nullable: true },
                          contextLength: { type: 'integer', nullable: true },
                          concurrency: { type: 'integer', nullable: true },
                          budgetUsdMax: { type: 'number', nullable: true },
                          minDecodeTokPerSec: { type: 'number', nullable: true },
                          maxVramGb: { type: 'number', nullable: true },
                          hwClass: { type: 'string', enum: ['discrete_gpu', 'unified', 'cpu_only'], nullable: true }
                        }
                      },
                      ambiguities: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            field: { type: 'string' },
                            message: { type: 'string' }
                          }
                        }
                      },
                      sizingQuery: { type: 'string', nullable: true, description: 'Ready-made /api/sizing query string; null when nothing mappable was recognized' }
                    }
                  }
                }
              }
            },
            '400': { description: 'Missing q parameter (code INVALID_PARAMS)', content: { 'application/problem+json': { schema: PROBLEM } } },
            '429': RATE_LIMITED
          }
        }
      },
      '/api/snapshots': {
        get: {
          summary: 'Versioned dataset snapshot IDs',
          description: 'Lists content-addressed dataset snapshots (e.g. snapshot-2026-08-21-a1b2c3d4). Pass any listed ID as ?snapshot= on /api/localmaxxing, /api/benchmarks or /api/best to get reproducible numbers. Snapshot IDs are stable for identical run sets within a fetch-time bucket; instances keep a bounded in-memory ring, so old IDs may expire.',
          responses: { '200': { description: '{current, snapshots[]}' } }
        }
      }
    },
    components: {
      headers: RATE_LIMIT_HEADERS,
      responses: { RateLimited: RATE_LIMITED_RESPONSE },
      schemas: {
        Problem: {
          type: 'object',
          description: 'RFC 9457 problem+json error body. Content-Type: application/problem+json.',
          required: ['type', 'title', 'status', 'code'],
          properties: {
            type: { type: 'string', format: 'uri', description: 'Stable problem-type URI, e.g. .../problems/invalid-params' },
            title: { type: 'string', description: 'Short human-readable summary' },
            status: { type: 'integer', description: 'HTTP status code' },
            detail: { type: 'string', description: 'Human-readable explanation of this occurrence' },
            instance: { type: 'string', description: 'Request path + query that produced the error' },
            code: { type: 'string', enum: Object.keys(ERROR_CODES), description: 'Stable machine-readable error code — branch on this, not on title/detail prose' }
          }
        }
      }
    },
    'x-error-codes': Object.entries(ERROR_CODES).map(([code, meta]) => ({
      code,
      httpStatus: meta.status,
      type: problemType(code),
      title: meta.title,
      description: meta.description
    }))
  };

  // Every JSON response carries schema_version + X-Schema-Version
  // (see _schema.js / CHANGELOG-API.md). The spec itself is no exception.
  return sendJson(res, spec, { cacheTtl: 3600 });
}
