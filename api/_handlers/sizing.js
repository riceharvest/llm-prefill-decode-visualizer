import { getAllRuns, aggregate } from '../_localmaxxing.js';
import { kvCache } from '../_math.js';
import { explainRecommendation } from '../_explain.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.end(JSON.stringify(body, null, 2));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
  if (/^(fp|bf)?16|f16$/.test(q)) return 16;
  if (/^(fp|bf)?8|f8$/.test(q)) return 8;
  if (/int?4|^q4/.test(q)) return 4;
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
    const slo = {
      maxTtftSeconds: params.maxTtftSeconds != null ? num(params.maxTtftSeconds, null) : null,
      maxTpotMs: params.maxTpotMs != null ? num(params.maxTpotMs, null) : null
    };

    // Explicit arch overrides, else estimated per group below.
    const explicitArch = ['numLayers', 'kvHeads', 'headDim'].every(k => params[k] != null)
      ? { numLayers: Math.round(Number(params.numLayers)), kvHeads: Math.round(Number(params.kvHeads)), headDim: Math.round(Number(params.headDim)) }
      : null;

    let runs = await getAllRuns();

    // Same filters as /api/best
    runs = runs.filter(r => r.modelFamily.includes(workload.model.toLowerCase()) || r.modelId?.toLowerCase().includes(workload.model.toLowerCase()));
    if (params.quant) runs = runs.filter(r => r.quantization?.toLowerCase() === String(params.quant).toLowerCase());
    if (params.hwClass) runs = runs.filter(r => r.hwClass?.toLowerCase() === String(params.hwClass).toLowerCase());
    // Budget cap: rig memory (VRAM or unified) must fit under it
    const maxVramGb = Number(params.maxVramGb);
    if (Number.isFinite(maxVramGb)) {
      runs = runs.filter(r => { const mem = r.vramGb ?? r.unifiedMemoryGb; return mem == null || mem <= maxVramGb; });
    }

    if (!runs.length) {
      return json(res, {
        error: `No comparable benchmark runs match model='${workload.model}'. Try a broader substring (e.g. 'qwen' instead of an exact hfId).`,
        workload
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
          ttftIqr: [g.prefill.q1, g.prefill.q3].map(v => v != null && workload.promptTokens ? Math.round((workload.promptTokens / v) * 1e4) / 1e4 : null),
          tpotIqrMs: [g.decode.q1, g.decode.q3].map(v => v != null ? Math.round((1000 / (v * Math.pow(b, -0.25))) * 100) / 100 : null),
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
      assumptions: {
        kvArchitecture: explicitArch || 'estimated from parameter count (exposed per recommendation in vramFit)',
        precisionBytes: 2,
        overheadGb: 1.5,
        memoryUnits: 'GiB — every memory figure (overheadGb, vramFit) is binary GiB, not decimal GB',
        quantBitsFallback: 'unparseable quantization labels assume 4.25 bits-per-weight'
      },
      recommendations
    });
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 502);
  }
}
