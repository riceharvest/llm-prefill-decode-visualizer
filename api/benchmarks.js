import { aggregate, DEFAULT_OUTLIER_IQRS } from './_localmaxxing.js';
import { resolveRuns } from './_snapshots.js';
import { parsePagination, paginate, descNumAscStrCmp, InvalidCursorError } from './_pagination.js';
import { enforceRateLimit } from './_ratelimit.js';
import { buildCaveats, rowCaveats } from './_caveats.js';
import { sendJson } from './_schema.js';
import { engineTag, matchesEngineQuery } from './_engine.js';
import { confidence, crossCheck } from './_crosscheck.js';
import { sendProblem, sendProblemFromError } from './_errors.js';

export const config = { runtime: 'nodejs' };

// Thin wrapper over the shared sender so every response carries
// schema_version + X-Schema-Version (see _schema.js / CHANGELOG-API.md).
function json(res, body, status = 200, cacheTtl = 600) {
  return sendJson(res, body, { status, cacheTtl });
}

// Shared pagination contract (see ./_pagination.js): ?limit=N (default 25, max
// 200) + opaque &cursor=; responses carry items[], has_more, next_cursor, total.
// Stable total order: best median decode first, group key as unique tiebreak
// (matches the ordering aggregate() already returns).
const GROUP_KEY = g => [g.decode.median, g.key];

export default async function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  try {
    const q = req.query || {};

    // Filters
    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    const model = q.model ? String(q.model).toLowerCase() : null;   // matches family OR raw hfId
    const quant = q.quant ? String(q.quant).toLowerCase() : null;
    const hwClass = q.hwClass ? String(q.hwClass).toLowerCase() : null; // discrete_gpu | unified | cpu_only
    const engineQ = q.engine ? String(q.engine) : null;             // matches "name version" tag substring

    const { runs: liveRuns, snapshot } = await resolveRuns(q);
    let runs = liveRuns;

    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);
    if (hwClass) runs = runs.filter(r => r.hwClass?.toLowerCase() === hwClass);
    if (engineQ) runs = runs.filter(r => matchesEngineQuery(r, engineQ));

    const crossEngine = ['1', 'true', 'yes'].includes(String(q.crossEngine).toLowerCase());

    const groupBy = q.groupBy === 'model' ? 'model'
      : q.groupBy === 'hardware' ? 'hardware'
      : q.groupBy === 'quant' ? 'quant'
      : 'hardwareModel'; // default: hardware × model family

    // Outlier policy: runs further than N IQRs from their group median are
    // flagged and excluded from the stats by default; pass
    // ?include_outliers=true to compute stats over every run.
    const includeOutliers = q.include_outliers === 'true' || q.includeOutliers === 'true';
    const outlierIqrsRaw = Number(q.outlierIqrs);
    const outlierIqrs = Number.isFinite(outlierIqrsRaw) && outlierIqrsRaw > 0
      ? Math.min(10, Math.max(1, outlierIqrsRaw))
      : DEFAULT_OUTLIER_IQRS;

    const keyFns = {
      hardware: r => r.hardwareKey,
      model: r => r.modelFamily,
      quant: r => `${r.hardwareKey}|${r.quantization}`,
      // default cohorts are same-engine (name+version); ?crossEngine=true
      // opts out into hardware×model groups that may mix engine builds.
      hardwareModel: crossEngine
        ? (r => `${r.hardwareKey}|${r.modelFamily}`)
        : (r => `${r.hardwareKey}|${r.modelFamily}|${engineTag(r)}`)
    };

    // Keep per-group membership so each group can carry its confidence block
    // and cross-hardware consistency checks.
    const members = new Map();
    for (const run of runs) {
      const k = keyFns[groupBy](run);
      if (!k) continue;
      if (!members.has(k)) members.set(k, []);
      members.get(k).push(run);
    }

    const { limit, cursor } = parsePagination(q, { defaultLimit: 25, maxLimit: 200 });

    // aggregate() sorts by median decode desc; enforce the full stable order
    const allGroups = aggregate(runs, keyFns[groupBy], { outlierIqrs, includeOutliers })
      .sort((a, b) => descNumAscStrCmp(GROUP_KEY(a), GROUP_KEY(b)));

    const page = paginate({ items: allGroups, limit, cursor, keyOf: GROUP_KEY, cmp: descNumAscStrCmp });

    const groups = page.items.map(g => ({
      ...g,
      models: undefined,
      modelFamilies: g.models,
      caveats: rowCaveats(g),
      engines: g.engines,
      mixedEngines: g.mixedEngines,
      confidence: { ...confidence(members.get(g.key) || []), ...(g.confidence || {}) },
      crossCheck: crossCheck(members.get(g.key) || []),
      bestRun: {
        runId: g.bestRun.runId,
        modelName: g.bestRun.modelName,
        hardware: g.bestRun.hardware,
        engine: g.bestRun.engine,
        engineVersion: g.bestRun.engineVersion,
        quantization: g.bestRun.quantization,
        prefillTokPerSec: g.bestRun.prefillTokPerSec,
        decodeTokPerSec: g.bestRun.decodeTokPerSec,
        source: g.bestRun.source
      }
    }));

    const warnings = groups.filter(g => g.mixedEngines)
      .map(g => `${g.key} mixes engine versions (${g.engines.join(', ')}) — treat delta with caution`);

    return json(res, {
      description: 'Aggregated community benchmark speeds (median + IQR + 95% bootstrap CI per group). Filter with ?hardware=&model=&quant=&hwClass=&engine=; regroup with ?groupBy=hardware|model|quant|hardwareModel. Default cohorts are same-engine; pass ?crossEngine=true to merge across engine builds. Cursor pagination: follow next_cursor until has_more is false. Each group carries a confidence block (run count, IQR spread %, outlier count, recency, grade) and a cross_check comparing multi-GPU rigs against the single-GPU baseline on the same model/quant.',
      snapshot,
      total: allGroups.length,
      matchedRuns: runs.length,
      distinctModelFamilies: [...new Set(runs.map(r => r.modelFamily))].length,
      distinctEngines: [...new Set(runs.map(r => engineTag(r)))],
      engineCohortedByDefault: !crossEngine && groupBy === 'hardwareModel',
      warnings,
      outlierPolicy: {
        thresholdIqrs: outlierIqrs,
        includeOutliers,
        note: `runs more than ${outlierIqrs} IQRs from their group median carry an outlier flag with a z-score-style deviation field${includeOutliers ? ' and are included in the stats' : ' and are excluded from the stats; pass ?include_outliers=true to include them'}`
      },
      note: 'medians are outlier-resistant; ci95 is the 95% percentile bootstrap interval (2,000 resamples) over the group\'s runs and label renders it as "median [lo–hi]"; overlapping intervals mean two groups are statistically tied; use bestRun for the single fastest measured run in each group; confidence.grade judges how much a ranking is backed by data and confidence.score (0-100) combines sample size, IQR width and outlier density',
      items: groups,
      has_more: page.has_more,
      next_cursor: page.next_cursor,
      caveats: buildCaveats(runs, allGroups)
    });
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return sendProblem(res, req, { status: 400, code: 'INVALID_CURSOR', detail: err.message });
    }
    return sendProblemFromError(res, req, err);
  }
}
