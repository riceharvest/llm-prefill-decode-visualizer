import { aggregate, DEFAULT_OUTLIER_IQRS } from '../_localmaxxing.js';
import { normalizeQueryModel } from '../_normalize.js';
import { resolveRuns } from '../_snapshots.js';
import { parsePagination, paginate, descNumAscStrCmp, InvalidCursorError, paginationScope } from '../_pagination.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { buildCaveats, rowCaveats } from '../_caveats.js';
import { sendJson } from '../_schema.js';
import { engineTag, matchesEngineQuery } from '../_engine.js';
import { confidence, crossCheck } from '../_crosscheck.js';
import { auditRuns, dataQuality } from '../_unit_audit.js';
import { sendProblem, sendProblemFromError } from '../_errors.js';
import { filterByMaxAge, parseMaxAgeParam } from '../_freshness.js';
import { parseContextBandParam, filterByContextBand } from '../_contextbands.js';
import { GROUP_BY_VALUES, enumParamWarning, positiveNumberParamWarning } from '../_param_validation.js';

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

// Query-param aliasing (#874): every filter parameter accepts BOTH its
// snake_case and camelCase spellings — neither is silently ignored. When both
// are present the snake_case spelling wins (matches the pre-existing
// `q.max_age ?? q.maxAge` precedence).
function readParam(q, snake, camel) {
  const snakeVal = q[snake];
  if (snakeVal !== undefined && snakeVal !== null && snakeVal !== '') return snakeVal;
  return q[camel];
}

export default async function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  try {
    const q = req.query || {};

    // Filters
    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    // Normalize like /api/best + /api/localmaxxing (issue #970) so spaced or
    // dotted display spellings ("Qwen3.6 27B") resolve to the same stored
    // family key instead of raw substring-matching nothing.
    const model = q.model ? normalizeQueryModel(q.model) : null;   // matches family OR raw hfId
    const quant = q.quant ? String(q.quant).toLowerCase() : null;
    const hwClass = q.hwClass ? String(q.hwClass).toLowerCase() : null; // discrete_gpu | unified | cpu_only
    const engineQ = q.engine ? String(q.engine) : null;             // matches "name version" tag substring

    const snapshotAt = new Date();
    const maxAgeDays = parseMaxAgeParam(readParam(q, 'max_age', 'maxAge'));
    const contextBand = parseContextBandParam(readParam(q, 'context_band', 'contextBand'));

    const { runs: liveRuns, snapshot } = await resolveRuns(q);
    let runs = liveRuns;

    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);
    if (hwClass) runs = runs.filter(r => r.hwClass?.toLowerCase() === hwClass);
    if (engineQ) runs = runs.filter(r => matchesEngineQuery(r, engineQ));
    if (maxAgeDays) runs = filterByMaxAge(runs, maxAgeDays, snapshotAt);
    runs = filterByContextBand(runs, contextBand);

    const crossEngine = ['1', 'true', 'yes'].includes(String(readParam(q, 'cross_engine', 'crossEngine')).toLowerCase());

    const groupByRaw = readParam(q, 'group_by', 'groupBy');
    const groupBy = groupByRaw === 'model' ? 'model'
      : groupByRaw === 'hardware' ? 'hardware'
      : groupByRaw === 'quant' ? 'quant'
      : 'hardwareModel'; // default: hardware × model family

    // Outlier policy: runs further than N IQRs from their group median are
    // flagged and excluded from the stats by default; pass
    // ?include_outliers=true to compute stats over every run.
    const includeOutliers = String(readParam(q, 'include_outliers', 'includeOutliers')).toLowerCase() === 'true';
    const outlierIqrsRaw = Number(readParam(q, 'outlier_iqrs', 'outlierIqrs'));
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

    // Cursor fingerprinting (#740 #755): bind cursors to the endpoint, every
    // row-shaping filter (incl. groupBy + outlier policy) and the resolved
    // snapshot id, so cross-endpoint / cross-filter / cross-refresh reuse is a
    // 400 instead of silently wrong pages.
    const scope = paginationScope('benchmarks', {
      hardware, model, quant, hwClass,
      engine: engineQ ?? '',
      maxAgeDays: maxAgeDays ?? '',
      contextBand: contextBand ?? '',
      groupBy,
      crossEngine: String(crossEngine),
      outlierIqrs,
      includeOutliers,
      snapshot: snapshot?.id ?? ''
    });
    const { limit, cursor } = parsePagination(q, { defaultLimit: 25, maxLimit: 200, scope });

    // aggregate() sorts by median decode desc; enforce the full stable order
    const allGroups = aggregate(runs, keyFns[groupBy], { outlierIqrs, includeOutliers })
      .sort((a, b) => descNumAscStrCmp(GROUP_KEY(a), GROUP_KEY(b)));

    const page = paginate({ items: allGroups, limit, cursor, keyOf: GROUP_KEY, cmp: descNumAscStrCmp, scope });

    const groups = page.items.map(g => ({
      ...g,
      models: undefined,
      modelFamilies: g.models,
      caveats: rowCaveats(g),
      engines: g.engines,
      mixedEngines: g.mixedEngines,
      confidence: { ...confidence(members.get(g.key) || []), ...(g.confidence || {}) },
      crossCheck: crossCheck(members.get(g.key) || []),
      dataQuality: dataQuality(members.get(g.key) || []),
      bestRun: {
        runId: g.bestRun.runId,
        modelName: g.bestRun.modelName,
        hardware: g.bestRun.hardware,
        engine: g.bestRun.engine,
        engineVersion: g.bestRun.engineVersion,
        quantization: g.bestRun.quantization,
        prefillTokPerSec: g.bestRun.prefillTokPerSec,
        decodeTokPerSec: g.bestRun.decodeTokPerSec,
        createdAt: g.bestRun.createdAt,
        source: g.bestRun.source
      }
    }));

    // Unit-consistency audit across every matched run (issue #43): summary
    // goes in the payload, per-group detail rides on each group's dataQuality.
    const auditSummary = auditRuns(runs);

    const warnings = groups.filter(g => g.mixedEngines)
      .map(g => `${g.key} mixes engine versions (${g.engines.join(', ')}) — treat delta with caution`);
    warnings.push(...groups.filter(g => g.mixedContextBands)
      .map(g => `${g.key} mixes context-length bands (${(g.contextBands?.bands || []).map(b => b.label).join(', ')}) — measured tok/s depends on context; treat delta with caution or filter with ?context_band=`));

    // Silent param-ignore signals (#443): a typo'd groupBy / non-numeric
    // max_age / invalid limit must not look like a successful default query.
    warnings.push(...[
      enumParamWarning('groupBy', q.groupBy, GROUP_BY_VALUES, groupBy),
      positiveNumberParamWarning('max_age', q.max_age ?? q.maxAge, maxAgeDays || null),
      positiveNumberParamWarning('limit', q.limit, limit, `used the default of ${limit}`)
    ].filter(Boolean));

    return json(res, {
      description: 'Aggregated community benchmark speeds (median + IQR + 95% bootstrap CI per group). Filter with ?hardware=&model=&quant=&hwClass=&engine=&context_band=lt1k|1k-8k|8k-32k|32k+; regroup with ?groupBy=hardware|model|quant|hardwareModel; exclude old measurements with ?max_age=<days>. Filter params accept both snake_case and camelCase spellings (e.g. group_by/groupBy, cross_engine/crossEngine, outlier_iqrs/outlierIqrs, include_outliers/includeOutliers, max_age/maxAge, context_band/contextBand). Default cohorts are same-engine; pass ?crossEngine=true to merge across engine builds. Cursor pagination: follow next_cursor until has_more is false. Each group carries a confidence block (run count, IQR spread %, outlier count, recency, grade) and a cross_check comparing multi-GPU rigs against the single-GPU baseline on the same model/quant.',
      snapshot,
      snapshotAt: snapshotAt.toISOString(),
      maxAgeDays: maxAgeDays || null,
      contextBand: contextBand || null,
      freshnessTiers: 'fresh <90d · aging <1y · stale ≥1y (per-group: staleness of newest run)',
      total: allGroups.length,
      matchedRuns: runs.length,
      distinctModelFamilies: [...new Set(runs.map(r => r.modelFamily))].length,
      distinctEngines: [...new Set(runs.map(r => engineTag(r)))],
      engineCohortedByDefault: !crossEngine && groupBy === 'hardwareModel',
      // Machine-readable unit declaration for every aggregate speed in items[]
      // (#776): decode/prefill medians etc. are tokens per second — declared
      // in-band instead of only inside description/note prose.
      units: { speed: 'tok/s' },
      warnings,
      outlierPolicy: {
        thresholdIqrs: outlierIqrs,
        includeOutliers,
        note: `runs more than ${outlierIqrs} IQRs from their group median carry an outlier flag with a z-score-style deviation field${includeOutliers ? ' and are included in the stats' : ' and are excluded from the stats; pass ?include_outliers=true to include them'}`
      },
      unitAudit: {
        runsAudited: auditSummary.runsAudited,
        flaggedRuns: auditSummary.flaggedRuns,
        flagCounts: auditSummary.flagCounts,
        note: 'unit-consistency audit per run: decode_above_roofline / decode_below_floor / prefill_below_floor / prefill_below_decode; each group carries a data_quality block (status ok|flagged) listing affected runIds'
      },
      note: 'medians are outlier-resistant; ci95 is the 95% percentile bootstrap interval (2,000 resamples) over the group\'s runs and label renders it as "median [lo–hi]"; overlapping intervals mean two groups are statistically tied; use bestRun for the single fastest measured run in each group; confidence.grade judges how much a ranking is backed by data and confidence.score (0-100) combines sample size, IQR width and outlier density; check freshness.majorReleaseWarnings before comparing across engine generations',
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
