import { getAllRuns, aggregate } from '../_localmaxxing.js';
import { kvCache } from '../_math.js';
import { explainRecommendation } from '../_explain.js';
import { locateQuantComponent } from '../_quant_tag.js';
import { sendJson } from '../_schema.js';

export const config = { runtime: 'nodejs' };

// Single shared sender (#963): stamps schema_version + X-Schema-Version.
function json(res, body, status = 200) {
  return sendJson(res, body, { status, cacheTtl: 600 });
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// SLO caps accept any finite value ≥ 0 — 0 is a valid (maximally strict) cap,
// not "unset" (#731).
function numSloCap(v) {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Parse the SLO/budget caps from query params into the response `slo` echo
 * block (#1052): TTFT/TPOT caps plus the VRAM budget cap, so agents can
 * audit which constraints were registered. Returns the echo object and the
 * numeric maxVramGb used for filtering.
 */
export function buildSlo(params) {
  const slo = {
    // #731: explicit 0 caps are honored (every rig fails the SLO) instead of
    // silently dropping the constraint — numSloCap accepts any finite ≥ 0.
    maxTtftSeconds: params.maxTtftSeconds != null ? numSloCap(params.maxTtftSeconds) : null,
    maxTpotMs: params.maxTpotMs != null ? numSloCap(params.maxTpotMs) : null
  };
  const maxVramGb = Number(params.maxVramGb);
  if (Number.isFinite(maxVramGb)) slo.maxVramGb = maxVramGb;
  return { slo, maxVramGb };
}

/**
 * Estimate bits-per-weight from a quantization label (q4_k_m → ~4.25,
 * q8_0 → 8.25-ish is wrong so plain digits win: 8 + 0.25 only for _k quants).
 * Unknown labels fall back to 4.25 — the typical community GGUF.
 */
export function bitsPerWeight(quantization) {
  const q = String(quantization || '').toLowerCase();
  const m = q.match(/^q(\d+(?:\.\d+)?)(?:[_-](\d+))?/);
  if (m) return Number(m[1]) + (m[2] !== undefined ? Number(m[2]) / 100 : /k/.test(q.slice(m[0].length)) ? 0.25 : 0);
  if (/^(fp|bf)?16$|^f16$/.test(q)) return 16;
  if (/^(fp|bf)?8$|^f8$/.test(q)) return 8;
  if (/^int?4$|^q4$|^q4(?=[_-])/.test(q)) return 4;

  // Composite/mixed tags (#1071): the whole-string rules above only anchor at
  // the start, so a tag like 'GPTQ-INT4-G64-sym-local+DFlash-BF16-local' used
  // to fall through to unanchored substring latching that disagreed with
  // _vramfit.js. Resolve via the shared anchored scanner instead: both fit
  // paths now pick the SAME weight-storage component (earliest in tag order).
  const comp = locateQuantComponent(q);
  if (comp && comp.text !== q) {
    if (comp.kind === 'int') return Number(comp.bitBase) === 4 ? 4 : 4.25; // sizing table has no int8 row
    if (comp.kind === 'f16') return 16;
    if (comp.kind === 'f8') return 8;
    if (comp.kind === 'gguf') return bitsPerWeight(comp.text); // reuse leading-q math on 'q4_k_m' etc.
    // mlx: sizing's plain-digits table has no effective-rate rows — fallback
  }
  return 4.25;
}

/**
 * Rough KV-cache architecture estimate when the caller doesn't pin
 * numLayers/kvHeads/headDim. Buckets by parameter count; exposed in the
 * response `assumptions` so agents can see (and override) the guess.
 */
export function estimateArch(paramsB) {
  if (!Number.isFinite(paramsB)) return null;
  if (paramsB >= 60) return { numLayers: 80, kvHeads: 8, headDim: 128 };
  if (paramsB >= 13) return { numLayers: 48, kvHeads: 8, headDim: 128 };
  return { numLayers: 32, kvHeads: 8, headDim: 128 };
}

const CONFIDENCE_LEVELS = [[6, 'high'], [3, 'medium']];

function confidenceLevel(runs) {
  for (const [min, level] of CONFIDENCE_LEVELS) if (runs >= min) return level;
  return 'low';
}

/**
 * GET /api/sizing — one canonical query for autonomous deployment planning:
 * given a workload spec, rank hardware by measured speed with VRAM fit math,
 * expected TTFT/TPOT from aggregated medians, and per-group sample confidence.
 *
 * ?model=<substr>            required — model family / hfId substring
 * ?contextLength=8192        target context per request (drives KV cache)
 * ?concurrency=1             simultaneous requests (scales KV, decays decode)
 * ?promptTokens=2048         tokens prefilled per request (TTFT input)
 * ?outputTokens=512          tokens decoded per request
 * ?maxTtftSeconds=1          SLO cap on expected TTFT
 * ?maxTpotMs=40              SLO cap on expected TPOT
 * ?maxVramGb=48              budget cap: rig memory must fit under this
 *
 * Units (#738 #866): every memory figure — maxVramGb, memoryGb and the whole
 * vramFit block — is GiB (binary, 1024-based), not decimal GB. The response
 * states this in its top-level `units` block.
 *
 * ?numLayers=&kvHeads=&headDim=   explicit KV arch (skips the estimate)
 * ?quant=q4_k_m&hwClass=…    same filters as /api/best
 * ?limit=N                   default 5, max 25
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }

  try {
    const params = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const model = params.model || params.m || '';
    if (!String(model).trim()) {
      return json(res, {
        error: "Missing required 'model' parameter — sizing is meaningless without knowing which model family to size for.",
        example: '/api/sizing?model=qwen&contextLength=32768&concurrency=4&maxTtftSeconds=2&maxTpotMs=50'
      }, 400);
    }

    const workload = {
      model: String(model),
      contextLength: Math.round(num(params.contextLength, 8192)),
      concurrency: Math.max(1, Math.round(num(params.concurrency ?? params.batchSize, 1))),
      promptTokens: Math.round(num(params.promptTokens, 2048)),
      outputTokens: Math.round(num(params.outputTokens, 512))
    };
    // Echo SLO caps + VRAM budget back (#1052); maxVramGb reused for filtering.
    // buildSlo honors #731 zero-caps via numSloCap.
    const { slo, maxVramGb } = buildSlo(params);

    // Explicit arch overrides, else estimated per group below.
    const explicitArch = ['numLayers', 'kvHeads', 'headDim'].every(k => params[k] != null)
      ? { numLayers: Math.round(Number(params.numLayers)), kvHeads: Math.round(Number(params.kvHeads)), headDim: Math.round(Number(params.headDim)) }
      : null;

    let runs = await getAllRuns();

    // Same filters as /api/best
    runs = runs.filter(r => r.modelFamily.includes(workload.model.toLowerCase()) || r.modelId?.toLowerCase().includes(workload.model.toLowerCase()));
    if (params.quant) runs = runs.filter(r => r.quantization?.toLowerCase() === String(params.quant).toLowerCase());
    if (params.hwClass) runs = runs.filter(r => r.hwClass?.toLowerCase() === String(params.hwClass).toLowerCase());
    // Budget cap: rig memory (VRAM or unified) must fit under it.
    // Unknown-memory rigs are EXCLUDED once a cap is requested (#632): a
    // null memoryGb can't be shown to fit a budget, so recommending it as
    // "under budget" is wrong. The drop count is echoed back additively.
    const hasBudgetCap = Number.isFinite(maxVramGb);
    let excludedUnknownMemoryRuns = 0;
    if (hasBudgetCap) {
      excludedUnknownMemoryRuns = runs.filter(r => (r.vramGb ?? r.unifiedMemoryGb) == null).length;
      runs = runs.filter(r => { const mem = r.vramGb ?? r.unifiedMemoryGb; return mem != null && mem <= maxVramGb; });
    }
    const budgetCap = hasBudgetCap ? { maxVramGb, excludedUnknownMemoryRuns } : undefined;

    if (!runs.length) {
      return json(res, {
        error: `No comparable benchmark runs match model='${workload.model}'. Try a broader substring (e.g. 'qwen' instead of an exact hfId).`,
        workload,
        ...(budgetCap ? { budgetCap } : {})
      }, 404);
    }

    const limit = Math.min(25, Math.max(1, Number(params.limit) || 5));
    const groups = aggregate(runs, r => `${r.hardwareKey}|${r.modelFamily}`);

    const recommendations = groups.map(g => {
      const s = g.bestRun;
      const memoryGb = s.vramGb ?? s.unifiedMemoryGb ?? null;
      const memSource = s.vramGb != null ? 'vram' : (s.unifiedMemoryGb != null ? 'unified' : null);

      // --- VRAM fit math ---
      const bpw = bitsPerWeight(s.quantization);
      const weightsGb = s.paramsB ? Math.round((s.paramsB * bpw / 8) * 100) / 100 : null;
      const arch = explicitArch || estimateArch(s.paramsB);
      const kv = arch ? kvCache({ ...arch, contextLength: workload.contextLength, precisionBytes: 2, batchSize: workload.concurrency }) : null;
      const overheadGb = 1.5; // engine runtime + activation buffers
      const requiredGb = weightsGb != null && kv
        ? Math.round((weightsGb + kv.totalGb + overheadGb) * 100) / 100
        : null;
      const headroomGb = requiredGb != null && memoryGb != null
        ? Math.round((memoryGb - requiredGb) * 100) / 100
        : null;

      // --- Expected performance from aggregated medians ---
      // Measured speeds are single-stream; with concurrency > 1 per-user decode
      // decays ~ B^-0.25 (same model as /api/compute batched).
      const b = workload.concurrency;
      const perUserDecode = g.decode.median * Math.pow(b, -0.25);
      const ttftSeconds = g.prefill.median > 0
        ? Math.round((workload.promptTokens / g.prefill.median) * 1e4) / 1e4
        : null;
      const tpotMs = perUserDecode > 0 ? Math.round((1000 / perUserDecode) * 100) / 100 : null;

      const meetsTtft = slo.maxTtftSeconds != null && ttftSeconds != null ? ttftSeconds <= slo.maxTtftSeconds : null;
      const meetsTpot = slo.maxTpotMs != null && tpotMs != null ? tpotMs <= slo.maxTpotMs : null;
      const fitsVram = headroomGb != null ? headroomGb >= 0 : null;

      return {
        hardware: s.hardware,
        hardwareKey: s.hardwareKey,
        hwClass: s.hwClass,
        gpu: s.gpu,
        gpuCount: s.gpuCount,
        memoryGb,
        memSource,
        modelFamily: s.modelFamily,
        exampleModel: s.modelName,
        quantization: s.quantization,
        engine: s.engine,
        vramFit: {
          weightsGb,
          bitsPerWeightAssumed: bpw,
          kvCacheGb: kv ? kv.totalGb : null,
          kvCacheAt: kv ? `${workload.contextLength} ctx × ${b} concurrent` : null,
          overheadGb,
          requiredGb,
          availableGb: memoryGb,
          headroomGb,
          fits: fitsVram
        },
        expected: {
          ttftSeconds,
          tpotMs,
          perUserDecodeTokPerSec: Math.round(perUserDecode * 10) / 10,
          aggregateDecodeTokPerSec: Math.round(perUserDecode * b * 10) / 10,
          // (#763) IQR bounds are ordered ascending [p25, p75] as named.
          // Speeds' q3 (fast) maps to the 25th-percentile time and q1 (slow)
          // to the 75th — so times come out [q3→lo, q1→hi], never descending.
          ttftIqr: [g.prefill.q3, g.prefill.q1].map(v => v != null && workload.promptTokens ? Math.round((workload.promptTokens / v) * 1e4) / 1e4 : null),
          tpotIqrMs: [g.decode.q3, g.decode.q1].map(v => v != null ? Math.round((1000 / (v * Math.pow(b, -0.25))) * 100) / 100 : null),
          measuredSingleStream: true,
          note: b > 1 ? 'measured speeds are single-stream; per-user decode decayed ~B^-0.25 for concurrency' : undefined
        },
        confidence: {
          runsInGroup: g.runs,
          level: confidenceLevel(g.runs),
          note: g.runs < 3 ? 'fewer than 3 runs — medians may not generalize' : undefined
        },
        meetsSlo: { ttft: meetsTtft, tpot: meetsTpot, vram: fitsVram, all: [meetsTtft, meetsTpot, fitsVram].every(v => v !== false) },
        // One-sentence human-readable explanation (#73): fit math + measured
        // source, pass-through ready for agent chat pipelines.
        explain: explainRecommendation({
          memoryGb,
          paramsB: s.paramsB,
          quantization: s.quantization,
          contextLength: workload.contextLength,
          fit: requiredGb != null
            ? { fits: fitsVram, estimatedWeightsGb: weightsGb, estimatedKvCacheGb: kv ? kv.totalGb : null, headroomGb }
            : null,
          decodeTokPerSec: g.decode.median,
          runId: s.runId,
          runsInGroup: g.runs
        }),
        source: s.source
      };
    })
      // Meet-SLO first, then fastest median decode.
      .sort((a, b2) => {
        if (a.meetsSlo.all !== b2.meetsSlo.all) return a.meetsSlo.all ? -1 : 1;
        return b2.expected.perUserDecodeTokPerSec - a.expected.perUserDecodeTokPerSec;
      })
      .slice(0, limit);

    return json(res, {
      description: 'Ranked hardware sizing for a workload spec. VRAM fit = weights + KV cache at target context × concurrency + overhead. Expected TTFT/TPOT come from aggregated benchmark medians (single-stream); confidence reflects sample count. All memory figures (memoryGb/maxVramGb and the vramFit block) are GiB — binary, 1024-based, not decimal GB (#738 #866).',
      units: { memory: 'GiB', note: 'all memory figures are GiB — binary, 1024-based, NOT decimal GB' },
      workload,
      slo,
      matchedRuns: runs.length,
      ...(budgetCap ? { budgetCap } : {}),
      assumptions: {
        kvArchitecture: explicitArch || 'estimated from parameter count (exposed per recommendation in vramFit)',
        precisionBytes: 2,
        overheadGb: 1.5,
        memoryUnits: 'GiB — every memory figure (overheadGb, vramFit) is binary GiB, not decimal GB',
        quantBitsFallback: 'unparseable quantization labels assume 4.25 bits-per-weight',
        // #637: fit-model provenance — /api/vram answers the same fit question
        // from real HF configs with its own quant table (4.85 bpw for q4_k_m
        // vs 4.25 here) and adds NO overhead. These fields let an agent
        // detect and reconcile that divergence instead of trusting two
        // contradictory verdicts blind.
        bpwSource: 'sizing-table',
        archSource: explicitArch ? 'query-param' : 'bucket-guess',
        overheadModel: 'flat-1.5gb'
      },
      recommendations
    });
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 502);
  }
}
