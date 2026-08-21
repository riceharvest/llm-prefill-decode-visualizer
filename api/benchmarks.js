import { getAllRuns, aggregate, normalizeModelId } from './_localmaxxing.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200, cacheTtl = 600) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `public, max-age=${cacheTtl}`);
  res.end(JSON.stringify(body, null, 2));
}

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 25));

    // Filters
    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    const model = q.model ? String(q.model).toLowerCase() : null;   // matches family OR raw hfId
    const quant = q.quant ? String(q.quant).toLowerCase() : null;
    const hwClass = q.hwClass ? String(q.hwClass).toLowerCase() : null; // discrete_gpu | unified | cpu_only

    let runs = await getAllRuns();

    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);
    if (hwClass) runs = runs.filter(r => r.hwClass?.toLowerCase() === hwClass);

    const groupBy = q.groupBy === 'model' ? 'model'
      : q.groupBy === 'hardware' ? 'hardware'
      : q.groupBy === 'quant' ? 'quant'
      : 'hardwareModel'; // default: hardware × model family

    const keyFns = {
      hardware: r => r.hardwareKey,
      model: r => r.modelFamily,
      quant: r => `${r.hardwareKey}|${r.quantization}`,
      hardwareModel: r => `${r.hardwareKey}|${r.modelFamily}`
    };

    const groups = aggregate(runs, keyFns[groupBy]).slice(0, limit).map(g => ({
      ...g,
      models: undefined,
      modelFamilies: g.models,
      bestRun: {
        runId: g.bestRun.runId,
        modelName: g.bestRun.modelName,
        hardware: g.bestRun.hardware,
        engine: g.bestRun.engine,
        quantization: g.bestRun.quantization,
        prefillTokPerSec: g.bestRun.prefillTokPerSec,
        decodeTokPerSec: g.bestRun.decodeTokPerSec,
        source: g.bestRun.source
      }
    }));

    return json(res, {
      description: 'Aggregated community benchmark speeds (median + IQR per group). Filter with ?hardware=&model=&quant=&hwClass=; regroup with ?groupBy=hardware|model|quant|hardwareModel.',
      matchedRuns: runs.length,
      distinctModelFamilies: [...new Set(runs.map(r => r.modelFamily))].length,
      note: 'medians are outlier-resistant; use bestRun for the single fastest measured run in each group',
      groups
    });
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 502);
  }
}
