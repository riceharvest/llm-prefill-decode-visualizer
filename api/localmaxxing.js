import { getAllRuns } from './_localmaxxing.js';
import { normalizeModelId } from './_normalize.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.end(JSON.stringify(body, null, 2));
}

/**
 * GET /api/localmaxxing — raw comparable runs (flattened, normalized).
 * ?hardware=<substr> &model=<substr> &quant=<exact> &limit=N (default 50, max 500)
 * Bare call returns the hardware-group summary.
 */
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 50));

    let runs = await getAllRuns();

    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    const model = q.model ? String(q.model).toLowerCase() : null;
    const quant = q.quant ? String(q.quant).toLowerCase() : null;

    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);

    if (!hardware && !model && !quant) {
      // Summary: hardware groups with run counts
      const groups = new Map();
      for (const r of runs) {
        if (!groups.has(r.hardwareKey)) {
          groups.set(r.hardwareKey, {
            hardware: r.hardware, hardwareKey: r.hardwareKey, hwClass: r.hwClass,
            runs: 0, modelFamilies: new Set()
          });
        }
        const g = groups.get(r.hardwareKey);
        g.runs += 1;
        g.modelFamilies.add(r.modelFamily);
      }
      return json(res, {
        description: 'Community-measured single-stream LLM benchmark runs. Filter with ?hardware=&model=&quant=&limit=N. Aggregated stats: /api/benchmarks. Ranked answers: /api/best.',
        totalComparableRuns: runs.length,
        hardwareGroups: [...groups.values()]
          .sort((a, b) => b.runs - a.runs)
          .map(g => ({
            hardware: g.hardware, hardwareKey: g.hardwareKey, hwClass: g.hwClass,
            runs: g.runs, distinctModelFamilies: g.modelFamilies.size
          }))
      });
    }

    return json(res, {
      description: 'Raw comparable runs (modelFamily collapses repo/quant variants of the same base model).',
      matchedRuns: runs.length,
      runs: runs.slice(0, limit)
    });
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 502);
  }
}
