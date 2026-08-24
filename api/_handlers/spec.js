import { enforceRateLimit, RATE_LIMIT, RATE_WINDOW_MS } from '../_ratelimit.js';
import { ERROR_CODES, problemType } from '../_errors.js';

export const config = { runtime: 'nodejs' };

import { sendJson, SCHEMA_VERSION } from '../_schema.js';

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
          retryAfterSeconds: { type: 'integer' },
          note: { type: 'string', description: 'Pointer to the documented budget in /llms.txt plus the X-RateLimit-* header names.' }
        }
      }
    }
  }
};

// x-rate-limit: machine-readable per-operation rate-limit metadata. Values are
// derived from the live limiter constants in api/_ratelimit.js so /api/spec can
// never drift from the actual budget. `enforced` mirrors which handler modules
// really call enforceRateLimit() — asserted against source in
// api/_spec_rate_limit.test.js.
const ENFORCED_PATHS = new Set([
  '/api/compute',
  '/api/presets',
  '/api/localmaxxing',
  '/api/runs',
  '/api/benchmarks',
  '/api/best',
  '/api/parse-constraints',
  '/api/watch',
  '/api/watch/rss.xml',
  '/api/watch/dispatch'
]);

function xRateLimit(enforced) {
  const ext = {
    enforced,
    limit: RATE_LIMIT,
    windowSeconds: RATE_WINDOW_MS / 1000,
    keying: 'per client IP (first X-Forwarded-For hop)',
    scope: 'best-effort fixed window, per serverless instance — concurrent warm instances each allow this budget and cold starts reset it'
  };
  if (enforced) {
    ext.headers = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'];
    ext.onExhaustion = {
      status: 429,
      retryAfterHeader: 'Retry-After (seconds)',
      errorCode: 'RATE_LIMITED',
      response: { $ref: '#/components/responses/RateLimited' }
    };
  } else {
    ext.note = 'This endpoint is currently not metered — it sets no rate-limit headers and never returns 429.';
  }
  return ext;
}

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

// ---------------------------------------------------------------------------
// Reusable component schemas (#319). These mirror the wire shapes emitted by
// /api/localmaxxing (_localmaxxing.js slim() + _freshness.js decorateRun()),
// /api/benchmarks (aggregate() in _localmaxxing.js), /api/best and
// /api/compute (_math.js). Fields are nullable where the upstream dataset may
// omit them; every response additionally carries the top-level envelope
// fields (schema_version, caveats, snapshot metadata) defined below.
// ---------------------------------------------------------------------------
const CI95 = {
  type: 'object',
  description: '95% percentile bootstrap confidence interval (2,000 resamples). Overlapping intervals across groups mean they are statistically tied.',
  required: ['lo', 'hi'],
  properties: {
    lo: { type: 'number', description: '2.5th percentile' },
    hi: { type: 'number', description: '97.5th percentile' }
  }
};

const SPEED_STATS = {
  type: 'object',
  description: 'Outlier-resistant distribution stats for one metric within a group.',
  required: ['median'],
  properties: {
    q1: { type: ['number', 'null'], description: 'First quartile' },
    median: { type: ['number', 'null'] },
    q3: { type: ['number', 'null'], description: 'Third quartile' },
    min: { type: ['number', 'null'] },
    max: { type: ['number', 'null'] },
    ci95: CI95,
    label: { type: ['string', 'null'], description: 'Rendered as "median [lo–hi]"', example: '105 [101–110]' }
  }
};

const CAVEAT = {
  type: 'object',
  description: 'Machine-readable dataset limitation. Branch on `code`; treat `severity` as display weight.',
  required: ['code', 'severity', 'summary'],
  properties: {
    code: { type: 'string', example: 'single_stream_only' },
    severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'warning'], description: 'Display weight. `warning` marks statistical limitations that should change how the number is used (n=1 groups, mixed engines/bands); `info` is contextual.' },
    summary: { type: 'string' },
    detail: { type: 'string' }
  },
  additionalProperties: true
};

const CONFIDENCE = {
  type: 'object',
  description: 'How much to trust one aggregate: sample size, decode-IQR width, outlier density, recency and an overall grade.',
  required: ['runs', 'grade'],
  properties: {
    runs: { type: 'integer', description: 'Comparable runs backing this aggregate' },
    iqrSpreadPct: { type: ['number', 'null'], description: 'Decode IQR / median × 100; tighter is better' },
    outliers: { type: 'integer', description: 'Runs outside the 1.5×IQR fences' },
    newestRunAgeDays: { type: ['integer', 'null'] },
    score: { type: ['integer', 'null'], minimum: 0, maximum: 100, description: '0–100 composite of sample size, spread and outliers (when computed)' },
    grade: { type: 'string', enum: ['low', 'medium', 'high'], description: "low <3 runs; high ≥10 runs with ≤40% decode IQR spread; medium otherwise" }
  }
};

const CONTRADICTION = {
  type: 'object',
  description: 'A multi-GPU rig whose numbers contradict the single-GPU baseline on the same model/quant — likely a misconfigured run.',
  required: ['kind', 'metric'],
  properties: {
    kind: { type: 'string', enum: ['slower_than_single', 'poor_scaling'] },
    vs: { type: 'string', description: 'Rig label, e.g. "2x RTX 4090"' },
    gpuCount: { type: 'integer' },
    metric: { type: 'string', enum: ['decode', 'prefill'] },
    singleTokPerSec: { type: 'number' },
    multiTokPerSec: { type: 'number' },
    deltaPct: { type: 'number' },
    perGpuScalingPct: { type: 'number' },
    note: { type: 'string' }
  }
};

const CROSS_CHECK = {
  type: 'object',
  description: 'Sanity comparison of multi-GPU rigs against the single-GPU baseline on the same model/quant.',
  required: ['relatedRigComparisons', 'contradictions'],
  properties: {
    relatedRigComparisons: { type: 'integer', description: 'Number of multi-GPU comparisons performed' },
    contradictions: { type: 'array', items: { $ref: '#/components/schemas/Contradiction' } }
  }
};

const SNAPSHOT_REF = {
  type: 'object',
  description: 'Content-addressed dataset snapshot actually served. Pin its id via ?snapshot= for reproducible numbers (see /api/snapshots).',
  required: ['id'],
  properties: {
    id: { type: 'string', example: 'snapshot-2026-08-21-a1b2c3d4' },
    createdAt: { type: ['string', 'null'], format: 'date-time' },
    runCount: { type: ['integer', 'null'] }
  }
};

const BEST_RUN_SUMMARY = {
  type: 'object',
  description: 'The single fastest measured run inside a group.',
  required: ['runId', 'decodeTokPerSec'],
  properties: {
    runId: { type: 'integer' },
    modelName: { type: ['string', 'null'] },
    hardware: { type: ['string', 'null'] },
    engine: { type: ['string', 'null'] },
    engineVersion: { type: ['string', 'null'] },
    quantization: { type: ['string', 'null'] },
    prefillTokPerSec: { type: 'integer' },
    decodeTokPerSec: { type: 'integer' },
    createdAt: { type: ['string', 'null'], format: 'date-time' },
    source: { type: ['string', 'null'], format: 'uri', description: 'Upstream run page' }
  }
};

/** One community-measured benchmark run (GET /api/localmaxxing items[]). */
const RUN = {
  type: 'object',
  description: 'Raw comparable community run, flattened and model-normalized (modelFamily collapses repo/quant variants of the same base model). Single-stream runs only.',
  required: ['runId', 'modelFamily', 'prefillTokPerSec', 'decodeTokPerSec'],
  properties: {
    runId: { type: 'integer', description: 'Stable upstream run id (also used as pagination tiebreak)' },
    createdAt: { type: ['string', 'null'], format: 'date-time' },
    modelFamily: { type: 'string', description: 'Normalized base-model family, e.g. qwen3.6-27b' },
    modelId: { type: ['string', 'null'], description: 'Hugging Face repo id when known' },
    modelName: { type: ['string', 'null'], description: 'Upstream display name' },
    paramsB: { type: ['number', 'null'], description: 'Parameter count in billions' },
    hardwareKey: { type: ['string', 'null'], description: 'Normalized rig key, e.g. rtx4090' },
    hardware: { type: ['string', 'null'], description: 'Human-readable rig label' },
    hwClass: { type: ['string', 'null'], enum: ['discrete_gpu', 'unified', 'cpu_only', null] },
    gpu: { type: ['string', 'null'] },
    gpuCount: { type: ['integer', 'null'], default: 1 },
    vramGb: { type: ['number', 'null'] },
    chip: { type: ['string', 'null'] },
    unifiedMemoryGb: { type: ['number', 'null'] },
    cpu: { type: ['string', 'null'] },
    engine: { type: ['string', 'null'], example: 'llama.cpp' },
    engineVersion: { type: ['string', 'null'] },
    quantization: { type: ['string', 'null'], example: 'q4_k_m' },
    prefillTokPerSec: { type: 'integer', description: 'Measured prompt-processing speed (tok/s)' },
    decodeTokPerSec: { type: 'integer', description: 'Measured single-stream decode speed (tok/s)' },
    promptTokens: { type: ['integer', 'null'] },
    outputTokens: { type: ['integer', 'null'] },
    contextLength: { type: ['integer', 'null'] },
    contextBand: { type: ['string', 'null'], enum: ['lt1k', '1k-8k', '8k-32k', '32k+', null], description: 'Context-length bucket; null when the run reports no usable contextLength' },
    ageDays: { type: ['integer', 'null'], description: 'Days since measurement (null when undated)' },
    staleness: { type: ['string', 'null'], enum: ['fresh', 'aging', 'stale', 'unknown', null], description: 'fresh <90d, aging <180d, stale otherwise, unknown when undated' },
    source: { type: ['string', 'null'], format: 'uri', description: 'Link to the upstream run page' }
  },
  additionalProperties: true
};

/** Per-group context-band mix (shared by BenchmarkGroup and BestResult). */
const CONTEXT_BANDS = {
  type: 'object',
  description: 'Context-length band mix inside the group — speeds depend on context, so a mixed group blends regimes.',
  properties: {
    bands: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          band: { type: 'string', enum: ['lt1k', '1k-8k', '8k-32k', '32k+'] },
          label: { type: 'string', description: 'Display label, e.g. "8k–32k"' },
          runs: { type: 'integer' }
        },
        additionalProperties: true
      }
    },
    unknownRuns: { type: 'integer', description: 'Runs reporting no usable contextLength' },
    distinctBands: { type: 'integer' },
    mixed: { type: 'boolean' }
  },
  additionalProperties: true
};

/** Per-group freshness block (shared by BenchmarkGroup and BestResult). */
const GROUP_FRESHNESS = {
  type: 'object',
  description: 'Recency of the runs backing this group.',
  properties: {
    newestRunAt: { type: ['string', 'null'], format: 'date-time' },
    oldestRunAt: { type: ['string', 'null'], format: 'date-time' },
    newestAgeDays: { type: ['integer', 'null'] },
    staleness: { type: ['string', 'null'], enum: ['fresh', 'aging', 'stale', 'unknown', null] },
    engineVersions: { type: 'array', items: { type: 'string' } },
    majorReleaseWarnings: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: true
};

/** One hardware×model-family aggregate (GET /api/benchmarks items[]). */
const BENCHMARK_GROUP = {
  type: 'object',
  description: 'Aggregated speeds for one group (hardware×model-family by default; regroup with ?groupBy=). Medians are outlier-resistant and carry 95% bootstrap CIs.',
  required: ['key', 'runs', 'prefill', 'decode'],
  properties: {
    key: { type: 'string', description: 'Group key, e.g. "rtx4090|qwen3.6-27b"', example: 'rtx4090|qwen3.6-27b' },
    runs: { type: 'integer', description: 'Comparable runs in the group' },
    prefill: { $ref: '#/components/schemas/SpeedStats' },
    decode: { $ref: '#/components/schemas/SpeedStats' },
    modelFamilies: { type: 'array', items: { type: 'string' } },
    engines: { type: 'array', items: { type: 'string' } },
    mixedEngines: { type: 'boolean', description: 'True when the group spans multiple engine builds — check freshness before comparing' },
    mixedContextBands: { type: ['boolean', 'null'], description: 'Present (true) only when ?context_band= filtering is off and the group mixes bands' },
    dataQuality: {
      type: ['object', 'null'],
      description: 'Unit-consistency audit over the group\'s runs (status ok|flagged).',
      properties: {
        status: { type: 'string', enum: ['ok', 'flagged'] },
        runsAudited: { type: 'integer' },
        flaggedRuns: { type: 'integer' },
        flagCounts: { type: 'object', additionalProperties: { type: 'integer' } },
        flagged: { type: 'array', items: { type: 'object', properties: { runId: { type: 'integer' }, codes: { type: 'array', items: { type: 'string' } } } } }
      },
      additionalProperties: true
    },
    caveats: { type: 'array', items: { $ref: '#/components/schemas/Caveat' }, description: 'Per-group flags (n=1 group, mixed engines)' },
    confidence: { $ref: '#/components/schemas/Confidence' },
    crossCheck: { $ref: '#/components/schemas/CrossCheck' },
    bestRun: { $ref: '#/components/schemas/BestRunSummary' },
    runsInStats: { type: 'integer', description: 'Runs actually included in the stats (outliers excluded by default)' },
    outliersExcludedFromStats: { type: 'integer', description: 'Runs fenced out of the stats by the IQR outlier rule' },
    outlierIqrs: { type: 'number', description: 'Outlier fence in IQRs from the group median (see top-level outlierPolicy)' },
    includeOutliers: { type: 'boolean', description: 'Whether outlier runs were included (echoes ?include_outliers=)' },
    outliers: {
      type: 'array',
      description: 'Flagged outlier runs (empty unless ?include_outliers=true); each carries the metrics that tripped the fence plus a z-score-style deviation.',
      items: { type: 'object', additionalProperties: true }
    },
    contextBands: CONTEXT_BANDS,
    freshness: GROUP_FRESHNESS
  },
  additionalProperties: true
};

/** One ranked recommendation row (GET /api/best results[]). */
const BEST_RESULT = {
  type: 'object',
  description: 'One ranked hardware×model recommendation. Medians carry 95% bootstrap CIs (medianXxxCi95 / medianXxxLabel); pricing/power/vramFit are estimates anchored on the group\'s best-measured run and are null when no anchor exists (cpu_only, unknown GPUs).',
  required: ['hardwareKey', 'modelFamily', 'runsInGroup', 'confidence', 'medianPrefillTokPerSec', 'medianDecodeTokPerSec'],
  properties: {
    hardware: { type: ['string', 'null'] },
    hardwareKey: { type: ['string', 'null'] },
    hwClass: { type: ['string', 'null'], enum: ['discrete_gpu', 'unified', 'cpu_only', null] },
    gpu: { type: ['string', 'null'] },
    gpuCount: { type: ['integer', 'null'], default: 1 },
    vramGb: { type: ['number', 'null'] },
    effectiveVramGb: { type: ['number', 'null'], description: 'Discrete VRAM, falling back to unified memory' },
    chip: { type: ['string', 'null'] },
    unifiedMemoryGb: { type: ['number', 'null'] },
    cpu: { type: ['string', 'null'] },
    modelFamily: { type: 'string' },
    exampleModel: { type: ['string', 'null'] },
    quantization: { type: ['string', 'null'] },
    engine: { type: ['string', 'null'] },
    runsInGroup: { type: 'integer' },
    confidence: { $ref: '#/components/schemas/Confidence' },
    medianPrefillTokPerSec: { type: 'number' },
    medianDecodeTokPerSec: { type: 'number' },
    bestDecodeTokPerSec: { type: ['number', 'null'] },
    medianPrefillCi95: CI95,
    medianPrefillLabel: { type: ['string', 'null'] },
    medianDecodeCi95: CI95,
    medianDecodeLabel: { type: ['string', 'null'] },
    caveats: { type: 'array', items: { $ref: '#/components/schemas/Caveat' } },
    newestRunAt: { type: ['string', 'null'], format: 'date-time' },
    newestAgeDays: { type: ['integer', 'null'] },
    staleness: { type: ['string', 'null'], enum: ['fresh', 'aging', 'stale', 'unknown', null] },
    engineVersions: { type: 'array', items: { type: 'string' }, description: 'Engine builds seen in the group (mixed builds → treat deltas with caution)' },
    majorReleaseWarnings: { type: 'array', items: { type: 'string' } },
    engines: { type: 'array', items: { type: 'string' }, description: '"engine version" tags seen in the group' },
    engineVersion: { type: ['string', 'null'], description: 'Engine build when the group is single-build; null/absent when mixed' },
    mixedEngines: { type: 'boolean', description: 'True when the group spans multiple engine builds' },
    mixedContextBands: { type: ['boolean', 'null'], description: 'Present (true) only when ?context_band= filtering is off and the group mixes bands' },
    contextBands: CONTEXT_BANDS,
    dataQuality: {
      type: ['object', 'null'],
      description: 'Unit-consistency audit over the group\'s runs (status ok|flagged).',
      properties: {
        status: { type: 'string', enum: ['ok', 'flagged'] },
        runsAudited: { type: 'integer' },
        flaggedRuns: { type: 'integer' },
        flagCounts: { type: 'object', additionalProperties: { type: 'integer' } },
        flagged: { type: 'array', items: { type: 'object', properties: { runId: { type: 'integer' }, codes: { type: 'array', items: { type: 'string' } } } } }
      },
      additionalProperties: true
    },
    ttftSeconds: { type: 'number', description: 'Expected time to first token at the default/requested scenario shape (default 2048-in / 512-out)' },
    decodeSeconds: { type: 'number', description: 'Projected decode walltime for the scenario output tokens' },
    projectedWalltimeSeconds: { type: 'number', description: 'Prefill + decode walltime for the scenario shape' },
    effectiveThroughputTokPerSec: { type: 'number', description: 'Total tokens / total walltime for the scenario shape' },
    prefillSharePct: { type: 'number', description: 'Share of scenario walltime spent prefilling' },
    decodeSharePct: { type: 'number', description: 'Share of scenario walltime spent decoding' },
    source: { type: ['string', 'null'], format: 'uri' },
    vramFit: {
      type: ['object', 'null'],
      description: 'Estimated fit at the requested context (present with ?fitCheck or ?contextLength): weights + KV cache vs available memory.',
      additionalProperties: true
    },
    pricing: {
      type: ['object', 'null'],
      description: 'USD street-price estimate with range, per-GPU breakdown, asOf date and eBay/Craigslist verification links; null when no anchor exists.',
      additionalProperties: true
    },
    power: {
      type: ['object', 'null'],
      description: 'Board power (TDP per card and total), typical whole-rig inference wattage and recommended PSU size; null when no anchor exists.',
      additionalProperties: true
    },
    explain: { type: ['string', 'null'], description: 'One-sentence human-readable explanation combining VRAM-fit math with the measured source — pass-through ready for agent chat pipelines' }
  },
  additionalProperties: true
};

/**
 * Inference-math result (GET /api/compute). Common core fields are typed;
 * each ?model= mode adds mode-specific extras (e.g. speedupVsVanilla for
 * speculative, perUserDecodeTokPerSec for batched, kvBytes for kvCache,
 * costUsdPerMillionTokens for cost) — hence additionalProperties: true.
 */
const COMPUTE_RESULT = {
  type: 'object',
  description: 'Computed inference metrics. Every successful result carries a deterministic `id` (calc_<hash> of the resolved inputs) replayable via /api/calc/{id}, plus a non-blocking `warnings` array flagging physically implausible inputs.',
  required: ['inputs', 'warnings'],
  properties: {
    id: { type: 'string', pattern: '^calc_[0-9a-f]{12}$', description: 'Deterministic content hash of the resolved request' },
    inputs: { type: 'object', description: 'Resolved input parameters (defaults filled in)', additionalProperties: true },
    warnings: {
      type: 'array',
      description: 'Implausibility warnings (empty when inputs are plausible); never affect the math or HTTP status.',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', enum: ['decode_above_bandwidth_roofline', 'prefill_above_compute_roofline', 'ttft_below_kernel_launch_floor'] },
          message: { type: 'string' }
        },
        additionalProperties: true
      }
    },
    ttftSeconds: { type: 'number', description: 'Time to first token (singleTurn/batched/agentic/kvCache/cost modes)' },
    tpotMs: { type: 'number', description: 'Time per output token in ms' },
    decodeSeconds: { type: 'number' },
    totalWalltimeSeconds: { type: 'number' },
    effectiveThroughputTokPerSec: { type: 'number' },
    prefillSharePct: { type: 'number' },
    decodeSharePct: { type: 'number' }
  },
  additionalProperties: true
};

/** GET /api/compute body: a ComputeResult plus the standard envelope stamp. */
const COMPUTE_RESPONSE = {
  allOf: [
    { $ref: '#/components/schemas/ComputeResult' }
  ],
  type: 'object',
  required: ['schema_version'],
  properties: {
    schema_version: { type: 'string', const: '1' }
  }
};

// Cursor-paginated list envelopes (shared pagination contract: total, items[],
// has_more, next_cursor — see _pagination.js).

/** GET /api/localmaxxing with any filter. */
const RUN_LIST_ENVELOPE = {
  type: 'object',
  description: 'Cursor-paginated raw run list, sorted by decode speed desc (runId tiebreak). Follow next_cursor until has_more is false.',
  required: ['total', 'items', 'has_more'],
  properties: {
    description: { type: 'string' },
    snapshot: { $ref: '#/components/schemas/SnapshotRef' },
    snapshotAt: { type: ['string', 'null'], format: 'date-time' },
    maxAgeDays: { type: ['number', 'null'], description: 'Echoed ?max_age= filter (null when unset)' },
    contextBand: { type: ['string', 'null'], enum: ['lt1k', '1k-8k', '8k-32k', '32k+', null], description: 'Echoed ?context_band= filter (null when unset)' },
    total: { type: 'integer', description: 'Total matching runs across all pages' },
    caveats: { type: 'array', items: { $ref: '#/components/schemas/Caveat' } },
    items: { type: 'array', items: { $ref: '#/components/schemas/Run' } },
    has_more: { type: 'boolean' },
    next_cursor: { type: ['string', 'null'], description: 'Opaque keyset cursor; pass back as ?cursor=' },
    rate_limit: { $ref: '#/components/schemas/RateLimit' },
    schema_version: { type: 'string', const: '1' }
  }
};

/** Bare GET /api/localmaxxing (no filters): hardware-group summary. */
const HARDWARE_SUMMARY_ENVELOPE = {
  type: 'object',
  description: 'Bare call (no hardware/model/quant filter): one summary row per hardware group, largest first.',
  required: ['totalComparableRuns', 'hardwareGroups'],
  properties: {
    description: { type: 'string' },
    snapshot: { $ref: '#/components/schemas/SnapshotRef' },
    snapshotAt: { type: ['string', 'null'], format: 'date-time' },
    maxAgeDays: { type: ['number', 'null'] },
    contextBand: { type: ['string', 'null'], enum: ['lt1k', '1k-8k', '8k-32k', '32k+', null] },
    totalComparableRuns: { type: 'integer' },
    caveats: { type: 'array', items: { $ref: '#/components/schemas/Caveat' } },
    hardwareGroups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hardware: { type: ['string', 'null'] },
          hardwareKey: { type: ['string', 'null'] },
          hwClass: { type: ['string', 'null'], enum: ['discrete_gpu', 'unified', 'cpu_only', null] },
          runs: { type: 'integer' },
          distinctModelFamilies: { type: 'integer' },
          staleness: { type: ['string', 'null'], enum: ['fresh', 'aging', 'stale', 'unknown', null] },
          newestRunAt: { type: ['string', 'null'], format: 'date-time' }
        },
        additionalProperties: true
      }
    },
    schema_version: { type: 'string', const: '1' }
  }
};

/** GET /api/benchmarks. */
const BENCHMARK_GROUP_LIST_ENVELOPE = {
  type: 'object',
  description: 'Cursor-paginated aggregate groups, sorted by median decode desc (group-key tiebreak). Follow next_cursor until has_more is false.',
  required: ['total', 'items', 'has_more'],
  properties: {
    description: { type: 'string' },
    note: { type: 'string' },
    snapshot: { $ref: '#/components/schemas/SnapshotRef' },
    snapshotAt: { type: ['string', 'null'], format: 'date-time' },
    total: { type: 'integer', description: 'Total matching groups across all pages' },
    matchedRuns: { type: 'integer', description: 'Comparable runs that survived filtering before grouping' },
    caveats: { type: 'array', items: { $ref: '#/components/schemas/Caveat' }, description: 'Dataset-level flags (n=1 share, mixed engine versions)' },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Human-readable group-level warnings (mixed context bands within a group key)' },
    maxAgeDays: { type: ['number', 'null'], description: 'Echoed ?max_age= filter (null when unset)' },
    contextBand: { type: ['string', 'null'], enum: ['lt1k', '1k-8k', '8k-32k', '32k+', null], description: 'Echoed ?context_band= filter (null when unset)' },
    distinctModelFamilies: { type: 'integer', description: 'Distinct model families across all matching runs' },
    distinctEngines: { type: 'array', items: { type: 'string' }, description: 'Distinct "engine version" tags across matching runs' },
    engineCohortedByDefault: { type: 'boolean', description: 'True when groups are keyed per engine build so mixed-engine stats never blend' },
    freshnessTiers: { type: 'string', description: 'Human-readable definition of the fresh/aging/stale tiers' },
    outlierPolicy: {
      type: 'object',
      description: 'How outlier runs are fenced and whether they are included in stats.',
      properties: {
        thresholdIqrs: { type: 'number' },
        includeOutliers: { type: 'boolean' },
        note: { type: 'string' }
      },
      additionalProperties: true
    },
    unitAudit: {
      type: 'object',
      description: 'Unit-consistency audit across all matching runs.',
      properties: {
        runsAudited: { type: 'integer' },
        flaggedRuns: { type: 'integer' },
        flagCounts: { type: 'object', additionalProperties: { type: 'integer' } },
        note: { type: 'string' }
      },
      additionalProperties: true
    },
    items: { type: 'array', items: { $ref: '#/components/schemas/BenchmarkGroup' } },
    has_more: { type: 'boolean' },
    next_cursor: { type: ['string', 'null'] },
    rate_limit: { $ref: '#/components/schemas/RateLimit' },
    schema_version: { type: 'string', const: '1' }
  }
};

/** GET /api/best. */
const BEST_LIST_ENVELOPE = {
  type: 'object',
  description: 'Ranked recommendations. Carries a deterministic `id` (hash of the resolved filters) replayable via /api/calc/{id}?endpoint=best&<same filters>.',
  required: ['rankedBy', 'results', 'caveats', 'warnings'],
  properties: {
    id: { type: 'string', pattern: '^calc_[0-9a-f]{12}$' },
    description: { type: 'string' },
    rankedBy: { type: 'string', enum: ['decode', 'prefill', 'cost', 'walltime'] },
    snapshot: { $ref: '#/components/schemas/SnapshotRef' },
    snapshotAt: { type: ['string', 'null'], format: 'date-time' },
    matchedRuns: { type: 'integer', description: 'Comparable runs that survived filtering' },
    excludedRuns: { type: ['integer', 'null'], description: 'Runs dropped by ?fitCheck= (present only with fitCheck)' },
    maxAgeDays: { type: ['number', 'null'], description: 'Echoed ?max_age= filter (null when unset)' },
    contextBand: { type: ['string', 'null'], enum: ['lt1k', '1k-8k', '8k-32k', '32k+', null], description: 'Echoed ?context_band= filter (null when unset)' },
    caveats: { type: 'array', items: { $ref: '#/components/schemas/Caveat' } },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Human-readable group-level warnings (mixed engine versions / context bands)' },
    results: { type: 'array', items: { $ref: '#/components/schemas/BestResult' } },
    rate_limit: { $ref: '#/components/schemas/RateLimit' },
    schema_version: { type: 'string', const: '1' }
  }
};

const SCHEMAS = {
  // RFC 9457 problem+json error body (#16)
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
  },
  // Shared building blocks
  Ci95Interval: CI95,
  SpeedStats: SPEED_STATS,
  Caveat: CAVEAT,
  Confidence: CONFIDENCE,
  Contradiction: CONTRADICTION,
  CrossCheck: CROSS_CHECK,
  SnapshotRef: SNAPSHOT_REF,
  RateLimit: {
    type: 'object',
    description: 'Machine-readable rate-limit state — the same numbers the X-RateLimit-* headers carry, for clients that only parse bodies.',
    required: ['limit', 'remaining', 'reset', 'window_seconds', 'policy'],
    properties: {
      limit: { type: 'integer', description: 'Requests allowed per window' },
      remaining: { type: 'integer', description: 'Requests remaining in the current window' },
      reset: { type: 'integer', description: 'Unix epoch seconds when the current window resets' },
      window_seconds: { type: 'integer', description: 'Window length in seconds' },
      policy: { type: 'string', description: 'Limiting policy, e.g. fixed-window per client IP' }
    }
  },
  BestRunSummary: BEST_RUN_SUMMARY,
  // Core resource schemas
  Run: RUN,
  BenchmarkGroup: BENCHMARK_GROUP,
  BestResult: BEST_RESULT,
  ComputeResult: COMPUTE_RESULT,
  // Envelope shapes
  ComputeResponse: COMPUTE_RESPONSE,
  RunListEnvelope: RUN_LIST_ENVELOPE,
  HardwareSummaryEnvelope: HARDWARE_SUMMARY_ENVELOPE,
  BenchmarkGroupListEnvelope: BENCHMARK_GROUP_LIST_ENVELOPE,
  BestListEnvelope: BEST_LIST_ENVELOPE
};

export default function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'LLM Prefill & Decode Speed Visualizer API',
      version: '2.6.0',
      // Two independent version numbers — `version` is the API *release*
      // version (surface: endpoints/params/docs); `x-schema-version` mirrors
      // the wire contract version (schema_version field + X-Schema-Version
      // header on every JSON response). They are decoupled by design; see
      // CHANGELOG-API.md § "Two version numbers (release version vs wire
      // schema version)" for the mapping and bump rules.
      'x-schema-version': SCHEMA_VERSION,
      description: 'LLM inference performance math and community-measured hardware benchmarks. All endpoints return JSON, support CORS, require no auth. URL versioning: every endpoint is also served under the /v1/ prefix (e.g. /v1/compute) — external consumers should harden onto /v1/; the unversioned /api/ paths keep working and remain the canonical docs location (/api/spec). Breaking changes will ship under a new version prefix with the previous one kept for at least 90 days (see CHANGELOG-API.md). Every response body carries a schema_version field ("1") and every response sets an X-Schema-Version header; info.version (2.6.0) is the API *release* version while schema_version is the independent wire *contract* version — they are decoupled by design, see CHANGELOG-API.md § "Two version numbers" for the mapping and for the versioning + deprecation policy. Human docs at /llms.txt. Rate limited to 120 requests/min per client (best-effort, per serverless instance); every response carries X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset, and exhaustion returns 429 with Retry-After. Benchmark endpoints (/api/localmaxxing, /api/benchmarks, /api/best) carry a machine-readable top-level `caveats` array (objects with code/severity/summary/detail) describing dataset limitations, and each aggregate carries a confidence block plus crossCheck. Errors follow RFC 9457 problem+json with a stable machine-readable code — see x-error-codes.'
    },
    servers: [
      { url: BASE, description: 'Canonical unversioned host — /api/* paths' },
      { url: BASE + '/v1', description: 'Versioned prefix (/v1/compute, /v1/benchmarks, …) — preferred for external consumers; maps 1:1 onto the /api/* paths' }
    ],
    paths: {
      '/api/compute': {
        get: {
          operationId: 'computeInference',
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
                  schema: { $ref: '#/components/schemas/ComputeResponse' },
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
          operationId: 'estimateVram',
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
          operationId: 'replayCalculation',
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
          operationId: 'listPresets',
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
          operationId: 'listBenchmarkRuns',
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
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/RunListEnvelope' },
                      { $ref: '#/components/schemas/HardwareSummaryEnvelope' }
                    ]
                  },
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
                        staleness: 'fresh',
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
      '/api/runs': {
        get: {
          operationId: 'dumpRunIndex',
          summary: 'Machine-readable dump of the FULL run index (comparable + non-comparable)',
          description: 'One-shot export of every community-measured run — including batched/non-comparable ones — so agents and crawlers can consume the whole dataset without JS or pagination round-trips. JSON envelope carries schemaVersion, generatedAt, rowCount, totalRunCount, comparableFilter and a structured dataDictionary; each run carries a `comparable` boolean so consumers can reproduce (or skip) the single-stream filter the aggregate endpoints use. CSV output is RFC 4180 with a `#`-comment preamble carrying metadata plus one dictionary line per column, served as a dated attachment. Shares the 10-minute cached upstream fetch with the other benchmark endpoints.',
          parameters: [
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'], default: 'json' } },
            { name: 'comparable', in: 'query', schema: { type: 'string', enum: ['all', 'true', 'false'], default: 'all' }, description: 'Subset rows on the single-stream flag: true = comparable runs only, false = non-comparable only, all = everything (default). totalRunCount always reports the unfiltered index size.' }
          ],
          responses: {
            '200': {
              description: '{schemaVersion, generatedAt, comparableFilter, rowCount, totalRunCount, comparableCount, dataDictionary[], runs[]} for format=json; RFC 4180 text/csv attachment for format=csv',
              content: {
                'application/json': {
                  example: {
                    description: 'Full machine-readable dump of the community-measured LLM benchmark run index…',
                    schemaVersion: 1,
                    generatedAt: '2026-08-23T05:00:00.000Z',
                    comparableFilter: 'all',
                    rowCount: 3642,
                    totalRunCount: 3642,
                    comparableCount: 3642,
                    dataDictionary: [{ column: 'runId', type: 'string', description: 'Upstream run identifier' }],
                    runs: [
                      {
                        runId: 58213,
                        createdAt: '2026-07-30T18:22:41.000Z',
                        comparable: true,
                        modelFamily: 'qwen3.6-27b',
                        modelId: 'unsloth/Qwen3.6-27B-MTP-GGUF',
                        hardwareKey: 'rtx4090',
                        engine: 'llama.cpp',
                        quantization: 'q4_k_m',
                        prefillTokPerSec: 3820,
                        decodeTokPerSec: 108,
                        contextLength: 8192,
                        contextBand: '8k-32k',
                        source: 'https://localmaxxing.com/en/runs/58213'
                      }
                    ]
                  }
                },
                'text/csv': {
                  schema: { type: 'string' },
                  example: '# dataset: localmaxxing full LLM benchmark run index\r\n# schema_version: 1\r\n# generated_at: 2026-08-23T05:00:00.000Z\r\n# rows: 3642\r\n# filter: none — every community-measured run (use the `comparable` column)\r\n# data dictionary (column: type — description):\r\nrunId,createdAt,comparable,…\r\n'
                }
              }
            },
            '400': { description: 'Invalid format/comparable value (code INVALID_PARAMS)', content: { 'application/problem+json': { schema: PROBLEM } } },
            '405': { description: 'Method not allowed (code METHOD_NOT_ALLOWED) — only GET and OPTIONS are supported', content: { 'application/problem+json': { schema: PROBLEM } } },
            '429': RATE_LIMITED,
            '502': DATA_ERRORS['502']
          }
        }
      },
      '/api/watch': {
        get: {
          operationId: 'listWatches',
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
          operationId: 'createWatch',
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
          operationId: 'deleteWatch',
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
          operationId: 'getWatchRssFeed',
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
          operationId: 'dispatchWatchWebhooks',
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
          operationId: 'getBenchmarkAggregates',
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
                  schema: { $ref: '#/components/schemas/BenchmarkGroupListEnvelope' },
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
          operationId: 'getBestConfigs',
          summary: 'Ranked answers: fastest or cheapest rigs for given constraints',
          description: 'Example: /api/best?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M by median decode speed. by=cost ranks by cost-efficiency instead. Medians carry 95% bootstrap CIs (medianXxxCi95 / medianXxxLabel). Responses carry a deterministic `id` (hash of the resolved filters) replayable via /api/calc/{id}?endpoint=best&<same filters>.',
          parameters: [
            { name: 'by', in: 'query', schema: { type: 'string', enum: ['decode', 'prefill', 'efficiency', 'walltime', 'confidence', 'cost'] }, default: 'decode' },
            { name: 'price', in: 'query', schema: { type: 'number' }, description: 'cost mode: rig purchase price in USD (default 0)' },
            { name: 'electricityRate', in: 'query', schema: { type: 'number' }, description: 'cost mode: $/kWh (default 0.15)' },
            { name: 'powerWatts', in: 'query', schema: { type: 'number' }, description: 'cost mode: whole-rig watts; defaults to an estimate per hwClass. Alias: powerDrawWatts (same spelling as /api/compute cost mode).' },
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
                  schema: { $ref: '#/components/schemas/BestListEnvelope' },
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
          operationId: 'getHealth',
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
          operationId: 'getSizingRecommendation',
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
          operationId: 'parseConstraints',
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
          operationId: 'listDatasetSnapshots',
          summary: 'Versioned dataset snapshot IDs',
          description: 'Lists content-addressed dataset snapshots (e.g. snapshot-2026-08-21-a1b2c3d4). Pass any listed ID as ?snapshot= on /api/localmaxxing, /api/benchmarks or /api/best to get reproducible numbers. Snapshot IDs are stable for identical run sets within a fetch-time bucket; instances keep a bounded in-memory ring, so old IDs may expire.',
          responses: { '200': { description: '{current, snapshots[]}' } }
        }
      }
    },
    components: {
      headers: RATE_LIMIT_HEADERS,
      responses: { RateLimited: RATE_LIMITED_RESPONSE },
      schemas: SCHEMAS
    },
    'x-error-codes': Object.entries(ERROR_CODES).map(([code, meta]) => ({
      code,
      httpStatus: meta.status,
      type: problemType(code),
      title: meta.title,
      description: meta.description
    }))
  };

  // x-examples — curl-style request + realistic response per operation,
  // derived from handler code and /llms.txt (no invented fields). Operations
  // that already carry an inline `example` on their 2xx response reuse it;
  // entries in X_EXAMPLES below only supply what is not already in the spec.
  const X_EXAMPLES = {
    '/api/compute': {
      get: {
        request: 'curl -s "$BASE/api/compute?model=singleTurn&promptTokens=4096&outputTokens=512&prefillSpeed=3800&decodeSpeed=105"'
      },
      post: {
        request: `curl -s -X POST "$BASE/api/compute" -H 'Content-Type: application/json' -d '{"batch":[{"model":"singleTurn","promptTokens":4096,"outputTokens":512,"prefillSpeed":3800,"decodeSpeed":105},{"model":"singleTurn","promptTokens":16384,"outputTokens":512,"prefillSpeed":3800,"decodeSpeed":105}]}'`,
        requestBody: { batch: [ { model: 'singleTurn', promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 }, { model: 'singleTurn', promptTokens: 16384, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 } ] },
        response: {
          batch: true, count: 2, okCount: 2, errorCount: 0,
          results: [
            { index: 0, ok: true, result: { id: 'calc_9536a8f7358a', inputs: { promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 }, warnings: [], ttftSeconds: 1.077895, tpotMs: 9.52381, decodeSeconds: 4.87619, totalWalltimeSeconds: 5.954085, effectiveThroughputTokPerSec: 773.922414, prefillSharePct: 18.103448, decodeSharePct: 81.896552, schema_version: '1' } },
            { index: 1, ok: true, result: { id: 'calc_1c62d9a04b17', inputs: { promptTokens: 16384, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 }, warnings: [], ttftSeconds: 4.311579, tpotMs: 9.52381, decodeSeconds: 4.87619, totalWalltimeSeconds: 9.187769, effectiveThroughputTokPerSec: 1841.724137, prefillSharePct: 46.921797, decodeSharePct: 53.078203, schema_version: '1' } }
          ]
        }
      }
    },
    '/api/vram': {
      get: {
        request: 'curl -s "$BASE/api/vram?hfId=meta-llama/Llama-3.1-8B-Instruct&context=65536&quant=q4_k_m&vramGb=24"',
        response: {
          inputs: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', context: 65536, quant: 'q4_k_m', resolvedQuant: 'q4_k_m', quantAssumed: false, batchSize: 1, kvPrecisionBytes: 2, vramGb: 24 },
          model: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', family: 'llama', resolutionSource: 'builtin-table', architecture: { numLayers: 32, kvHeads: 8, headDim: 128 }, paramsTotal: 8030261312, paramsB: 8.03, notes: [] },
          weights: { gb: 4.49, source: '8,030,261,312 params × 0.56 bpw', sourceKind: 'params×quant', quant: 'q4_k_m', bytesPerParam: 0.56 },
          kvCache: { bytesPerToken: 131072, kbPerToken: 128, mbPerToken: 0.125, gbAtContext: 8, formula: '2 × 32 layers × 8 KV heads × 128 dim × 2B × 65,536 ctx × 1 batch' },
          total: { gb: 12.49, breakdown: { weightsGb: 4.49, kvCacheGb: 8 } },
          contextWindow: 131072,
          fits: { vramGb: 24, fits: true, maxContextTokens: 155648 },
          projection: null
        }
      }
    },
    '/api/calc/{id}': {
      get: {
        request: 'curl -s "$BASE/api/calc/calc_9536a8f7358a?model=singleTurn&promptTokens=4096&outputTokens=512&prefillSpeed=3800&decodeSpeed=105"',
        response: {
          id: 'calc_9536a8f7358a', verified: true,
          inputs: { promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 },
          warnings: [], ttftSeconds: 1.077895, tpotMs: 9.52381, decodeSeconds: 4.87619, totalWalltimeSeconds: 5.954085, effectiveThroughputTokPerSec: 773.922414, prefillSharePct: 18.103448, decodeSharePct: 81.896552, schema_version: '1'
        }
      }
    },
    '/api/presets': {
      get: { request: 'curl -s "$BASE/api/presets"' }
    },
    '/api/localmaxxing': {
      get: {
        request: 'curl -s "$BASE/api/localmaxxing?model=qwen3.6-27b&quant=q4_k_m&limit=50"'
      },
      post: {
        request: `curl -s -X POST "$BASE/api/localmaxxing" -H 'Content-Type: application/json' -d '{"model":"unsloth/Qwen3.6-27B-MTP-GGUF","quant":"q4_k_m","hardware":"RTX 4090 24GB","hwClass":"discrete_gpu","prefillTokPerSec":3820,"decodeTokPerSec":108,"engine":"llama.cpp","engineVersion":"b6123","contextLength":8192}'`,
        requestBody: { model: 'unsloth/Qwen3.6-27B-MTP-GGUF', quant: 'q4_k_m', hardware: 'RTX 4090 24GB', hwClass: 'discrete_gpu', prefillTokPerSec: 3820, decodeTokPerSec: 108, engine: 'llama.cpp', engineVersion: 'b6123', contextLength: 8192 },
        response: {
          description: 'Run accepted and queued for manual review. It will appear in GET /api/localmaxxing only after approval.',
          status: 'queued',
          reviewStatus: 'pending',
          submissionId: 'sub_9f3ce2a17b84'
        }
      }
    },
    '/api/benchmarks': {
      get: { request: 'curl -s "$BASE/api/benchmarks?groupBy=hardware&limit=25"' }
    },
    '/api/best': {
      get: { request: 'curl -s "$BASE/api/best?by=decode&maxParamsB=8&quant=q4_k_m&limit=10"' }
    },
    '/api/watch': {
      get: { request: 'curl -s "$BASE/api/watch"' },
      post: {
        request: `curl -s -X POST "$BASE/api/watch" -H 'Content-Type: application/json' -d '{"model":"Qwen3 32B","hardware":"RTX 4090","quant":"q4_k_m","webhookUrl":"https://example.com/hooks/llm-watch"}'`,
        requestBody: { model: 'Qwen3 32B', hardware: 'RTX 4090', quant: 'q4_k_m', webhookUrl: 'https://example.com/hooks/llm-watch' },
        response: {
          description: 'Watch created. Poll the rssUrl for new runs; if you registered a webhookUrl, POST /api/watch/dispatch delivers unseen matching runs to it. The secret is shown once — it is required to DELETE and is sent to your webhook as X-Watch-Secret.',
          watchId: 'watch_abc123_x9', secret: 'wsec_4f8d21c9b7',
          rssUrl: '/api/watch/rss.xml?model=Qwen3+32B&hardware=RTX+4090&quant=q4_k_m',
          matchingExistingRuns: []
        }
      },
      delete: {
        request: 'curl -s -X DELETE "$BASE/api/watch?id=watch_abc123_x9&secret=wsec_4f8d21c9b7"',
        response: '(204 No Content)'
      }
    },
    '/api/watch/rss.xml': {
      get: {
        request: 'curl -s "$BASE/api/watch/rss.xml?model=Qwen3+32B&hardware=RTX+4090&quant=q4_k_m"',
        response: '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Community benchmark runs — Qwen3 32B on RTX 4090</title><item><title>108 tok/s decode · q4_k_m · llama.cpp b6123</title><link>https://localmaxxing.com/en/runs/58213</link><pubDate>Wed, 30 Jul 2026 18:22:41 GMT</pubDate></item></channel></rss>'
      }
    },
    '/api/watch/dispatch': {
      get: {
        request: 'curl -s "$BASE/api/watch/dispatch"',
        response: {
          dispatched: 1, totalNewRuns: 2,
          results: [{ watchId: 'watch_abc123_x9', newRuns: 2, delivered: true }],
          schemaNote: 'Payload shape per webhook is the watch.new_runs object echoed in previewPayload.',
          previewPayload: { type: 'watch.new_runs', watchId: 'watch_abc123_x9', runs: [], deliveredAt: '2026-08-23T09:00:00.000Z' }
        }
      }
    },
    '/api/health': {
      get: {
        request: 'curl -s "$BASE/api/health"',
        response: {
          ok: true, service: 'llm-prefill-decode-visualizer', time: '2026-08-23T09:00:00.000Z',
          upstreamFreshness: { status: 'fresh', fetchedAt: '2026-08-23T08:58:00.000Z', ageSeconds: 120, ttlSeconds: 600, rowCount: 3642, source: 'localmaxxing.com' },
          cacheAge: 120
        }
      }
    },
    '/api/sizing': {
      get: {
        request: 'curl -s "$BASE/api/sizing?model=qwen&contextLength=32768&concurrency=4&maxTtftSeconds=2&maxTpotMs=50&maxVramGb=48"',
        response: {
          description: 'Ranked hardware sizing for a workload spec. VRAM fit = weights + KV cache at target context × concurrency + overhead. Expected TTFT/TPOT come from aggregated benchmark medians (single-stream); confidence reflects sample count.',
          workload: { model: 'qwen', contextLength: 32768, concurrency: 4, promptTokens: 2048, outputTokens: 512 },
          slo: { maxTtftSeconds: 2, maxTpotMs: 50, maxVramGb: 48 },
          matchedRuns: 214,
          assumptions: { kvArchitecture: 'estimated from parameter count (exposed per recommendation in vramFit)', precisionBytes: 2, overheadGb: 1.5, quantBitsFallback: 'unparseable quantization labels assume 4.25 bits-per-weight' },
          recommendations: [{
            hardware: 'RTX 4090 24GB', hardwareKey: 'rtx4090', hwClass: 'discrete_gpu', gpu: 'RTX 4090', gpuCount: 1,
            modelFamily: 'qwen3.6-27b', exampleModel: 'unsloth/Qwen3.6-27B-MTP-GGUF', quantization: 'q4_k_m', engine: 'llama.cpp',
            vramFit: { bitsPerWeightAssumed: 4.25, kvCacheGb: 28, kvCacheAt: '32768 ctx × 4 concurrent', availableGb: 24, fits: false },
            expected: { perUserDecodeTokPerSec: 70.2, aggregateDecodeTokPerSec: 280.8, ttftIqr: [0.53, 0.57], tpotIqrMs: [13.51, 15.29], measuredSingleStream: true, note: 'measured speeds are single-stream; per-user decode decayed ~B^-0.25 for concurrency' },
            confidence: { runsInGroup: 14, level: 'high' },
            meetsSlo: { ttft: true, tpot: true, vram: false, all: false },
            explain: 'Estimated fit: ~16GB weights + ~28GB KV at 32768 ctx × 4 concurrent exceeds 24GB — consider a smaller context or fewer concurrent streams; measured 105 tok/s single-stream decode across 14 runs.',
            source: 'https://localmaxxing.com/en/runs/58213'
          }]
        }
      }
    },
    '/api/parse-constraints': {
      get: {
        request: 'curl -s "$BASE/api/parse-constraints?q=self-hosted%20Qwen%2027B%20at%20Q4%20for%2010%20users%20under%20%241500"',
        response: {
          input: 'self-hosted Qwen 27B at Q4 for 10 users under $1500',
          recognizedCount: 5,
          constraints: { deployment: 'self-hosted', modelFamily: 'qwen', paramsB: 27, quantization: 'q4', contextLength: null, concurrency: 10, budgetUsdMax: 1500, minDecodeTokPerSec: null, maxVramGb: null, hwClass: null },
          ambiguities: [{ field: 'concurrency', message: '10 users: assume 1 stream each or batched?' }],
          sizingQuery: 'model=qwen&paramsB=27&quant=q4&concurrency=10&budgetUsdMax=1500'
        }
      }
    },
    '/api/snapshots': {
      get: {
        request: 'curl -s "$BASE/api/snapshots"',
        response: {
          description: 'Content-addressed dataset snapshots. Pin any data endpoint with ?snapshot=<id> for reproducible results. Snapshot IDs are stable for identical run sets within a fetch-time bucket; instances keep a bounded in-memory ring, so old IDs may expire.',
          current: 'snapshot-2026-08-21-a1b2c3d4',
          snapshots: [{ id: 'snapshot-2026-08-21-a1b2c3d4', createdAt: '2026-08-21T09:14:03.000Z', runCount: 3642 }]
        }
      }
    },
    '/api/runs': {
      get: {
        request: 'curl -s "$BASE/api/runs?format=json&comparable=true"'
      }
    }
  };

  // Attach x-examples to every operation. Response defaults to the inline
  // example already present on the 2xx response, so GET endpoints whose spec
  // entry already documents an exact payload need no X_EXAMPLES entry.
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'delete']) {
      const op = item[method];
      if (!op) continue;
      const inline = op.responses?.['200']?.content?.['application/json']?.example
        ?? op.responses?.['201']?.content?.['application/json']?.example;
      const entry = X_EXAMPLES[p]?.[method] || {};
      op['x-examples'] = {
        request: entry.request,
        ...(entry.requestBody ? { requestBody: entry.requestBody } : {}),
        response: entry.response !== undefined ? entry.response : (inline ?? null)
      };
    }
  }

  // Stamp x-rate-limit on every operation plus a root-level default so agents
  // can plan request budgets directly from /api/spec without probing 429s.
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
      if (item[method]) item[method]['x-rate-limit'] = xRateLimit(ENFORCED_PATHS.has(path));
    }
  }
  spec['x-rate-limit'] = {
    summary: 'Global default; per-operation values live under paths[*][method].x-rate-limit.',
    ...xRateLimit(true)
  };

  // Every JSON response carries schema_version + X-Schema-Version
  // (see _schema.js / CHANGELOG-API.md). The spec itself is no exception.
  return sendJson(res, spec, { cacheTtl: 3600 });
}
