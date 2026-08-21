import { getAllRuns, aggregate } from './_localmaxxing.js';
import { parsePagination, paginate, descNumAscStrCmp, InvalidCursorError } from './_pagination.js';
import { tagCohorts, compareWarning } from '../src/utils/engineVersion.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200, cacheTtl = 600) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `public, max-age=${cacheTtl}`);
  res.end(JSON.stringify(body, null, 2));
}

// Shared pagination contract (see ./_pagination.js): ?limit=N (default 25, max
// 200) + opaque &cursor=; responses carry items[], has_more, next_cursor, total.
// Stable total order: best median decode first, group key as unique tiebreak
// (matches the ordering aggregate() already returns).
const GROUP_KEY = g => [g.decode.median, g.key];

export default async function handler(req, res) {
  try {
    const q = req.query || {};

    // Filters
    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    const model = q.model ? String(q.model).toLowerCase() : null;   // matches family OR raw hfId
    const quant = q.quant ? String(q.quant).toLowerCase() : null;
    const hwClass = q.hwClass ? String(q.hwClass).toLowerCase() : null; // discrete_gpu | unified | cpu_only
    const engine = q.engine ? String(q.engine).toLowerCase() : null;    // substring on "engine build" cohort tag

    let runs = await getAllRuns();

    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);
    if (hwClass) runs = runs.filter(r => r.hwClass?.toLowerCase() === hwClass);
    if (engine) runs = runs.filter(r => r.engineTag?.toLowerCase().includes(engine));

    const groupBy = q.groupBy === 'model' ? 'model'
      : q.groupBy === 'hardware' ? 'hardware'
      : q.groupBy === 'quant' ? 'quant'
      : q.groupBy === 'engine' ? 'engine'
      : 'hardwareModel'; // default: hardware × model family

    const keyFns = {
      hardware: r => r.hardwareKey,
      model: r => r.modelFamily,
      quant: r => `${r.hardwareKey}|${r.quantization}`,
      engine: r => r.engineTag,
      hardwareModel: r => `${r.hardwareKey}|${r.modelFamily}`
    };

    const { limit, cursor } = parsePagination(q, { defaultLimit: 25, maxLimit: 200 });

    // Keep the raw per-group runs around so each group can report its
    // engine-version cohorts (issue #29).
    const runsByKey = new Map();
    for (const r of runs) {
      const k = keyFns[groupBy](r);
      if (!k) continue;
      if (!runsByKey.has(k)) runsByKey.set(k, []);
      runsByKey.get(k).push(r);
    }

    // aggregate() sorts by median decode desc; enforce the full stable order
    const allGroups = aggregate(runs, keyFns[groupBy])
      .sort((a, b) => descNumAscStrCmp(GROUP_KEY(a), GROUP_KEY(b)));

    const page = paginate({ items: allGroups, limit, cursor, keyOf: GROUP_KEY, cmp: descNumAscStrCmp });

    const groups = page.items.map(g => {
      const cohort = tagCohorts(runsByKey.get(g.key) || []);
      return {
        ...g,
        models: undefined,
        modelFamilies: g.models,
        engines: cohort.cohorts,
        mixedEngines: cohort.mixed,
        warning: cohort.mixed
          ? compareWarning(cohort.tags[0], cohort.tags[1])
          : null,
        bestRun: {
          runId: g.bestRun.runId,
          modelName: g.bestRun.modelName,
          hardware: g.bestRun.hardware,
          engine: g.bestRun.engine,
          engineTag: g.bestRun.engineTag,
          quantization: g.bestRun.quantization,
          prefillTokPerSec: g.bestRun.prefillTokPerSec,
          decodeTokPerSec: g.bestRun.decodeTokPerSec,
          source: g.bestRun.source
        }
      };
    });

    const overallCohort = tagCohorts(runs);
    return json(res, {
      description: 'Aggregated community benchmark speeds (median + IQR per group). Filter with ?hardware=&model=&quant=&hwClass=&engine=; regroup with ?groupBy=hardware|model|quant|engine|hardwareModel. Cursor pagination: follow next_cursor until has_more is false.',
      total: allGroups.length,
      matchedRuns: runs.length,
      distinctModelFamilies: [...new Set(runs.map(r => r.modelFamily))].length,
      engineCohorts: overallCohort.cohorts,
      engineWarning: !q.engine && overallCohort.mixed
        ? 'results mix engine versions — pass ?engine=<tag substring> for a same-engine cohort'
        : null,
      note: 'medians are outlier-resistant; use bestRun for the single fastest measured run in each group; mixedEngines groups span engine versions — treat cross-version deltas with caution',
      items: groups,
      has_more: page.has_more,
      next_cursor: page.next_cursor
    });
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return json(res, { error: err.message }, 400);
    }
    return json(res, { error: String(err.message || err) }, 502);
  }
}
