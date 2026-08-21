import { getAllRuns, aggregate } from './_localmaxxing.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.end(JSON.stringify(body, null, 2));
}

/**
 * GET /api/best — ranked answers to natural benchmark questions.
 *
 * ?by=decode|prefill|efficiency   rank metric (default decode)
 * ?model=<substr>                 restrict to model family / hfId substring
 * ?maxParamsB=8                   only models at or under this size
 * ?quant=q4_k_m                   exact quantization match (case-insensitive)
 * ?hwClass=discrete_gpu|unified|cpu_only
 * ?hardware=<substr>              restrict rigs by name substring
 * ?limit=N                        default 10
 */
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 10));
    const by = ['decode', 'prefill', 'efficiency'].includes(q.by) ? q.by : 'decode';

    let runs = await getAllRuns();

    if (q.model) {
      const m = String(q.model).toLowerCase();
      runs = runs.filter(r => r.modelFamily.includes(m) || r.modelId?.toLowerCase().includes(m));
    }
    if (q.maxParamsB) {
      const maxP = Number(q.maxParamsB);
      if (Number.isFinite(maxP)) runs = runs.filter(r => r.paramsB && r.paramsB <= maxP);
    }
    if (q.quant) runs = runs.filter(r => r.quantization?.toLowerCase() === String(q.quant).toLowerCase());
    if (q.hwClass) runs = runs.filter(r => r.hwClass?.toLowerCase() === String(q.hwClass).toLowerCase());
    if (q.hardware) {
      const h = String(q.hardware).toLowerCase();
      runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(h) || r.hardware?.toLowerCase().includes(h));
    }

    // Rank per hardware rig × model family using the group's median decode,
    // so one lucky run doesn't top the chart.
    const groups = aggregate(runs, r => `${r.hardwareKey}|${r.modelFamily}`);

    const ranked = groups
      .map(g => {
        const sample = g.bestRun;
        return {
          hardware: sample.hardware,
          hardwareKey: sample.hardwareKey,
          hwClass: sample.hwClass,
          gpu: sample.gpu,
          gpuCount: sample.gpuCount,
          vramGb: sample.vramGb,
          chip: sample.chip,
          unifiedMemoryGb: sample.unifiedMemoryGb,
          cpu: sample.cpu,
          modelFamily: sample.modelFamily,
          exampleModel: sample.modelName,
          quantization: sample.quantization,
          engine: sample.engine,
          runsInGroup: g.runs,
          medianPrefillTokPerSec: g.prefill.median,
          medianDecodeTokPerSec: g.decode.median,
          bestDecodeTokPerSec: g.decode.max,
          source: sample.source
        };
      })
      .sort((a, b) =>
        by === 'prefill' ? b.medianPrefillTokPerSec - a.medianPrefillTokPerSec
        : by === 'efficiency' ? (b.medianDecodeTokPerSec / Math.max(1, b.exampleModel ? 1 : 1)) - (a.medianDecodeTokPerSec / Math.max(1, a.exampleModel ? 1 : 1))
        : b.medianDecodeTokPerSec - a.medianDecodeTokPerSec
      )
      .slice(0, limit);

    return json(res, {
      description: 'Ranked hardware×model groups by measured community speed. Medians are outlier-resistant; runsInGroup shows sample size.',
      rankedBy: by,
      matchedRuns: runs.length,
      results: ranked
    });
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 502);
  }
}
