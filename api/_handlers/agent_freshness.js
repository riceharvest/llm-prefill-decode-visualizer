// GET /api/agent/freshness.json — agent-readable data-freshness and
// confidence report (alias: /api/agent/confidence.json, same handler).
//
// Agents consuming benchmark numbers need to know how much to trust them
// before acting. This endpoint wraps the EXISTING freshness/confidence
// machinery — groupFreshness() + staleness tiers (api/_freshness.js),
// confidenceFor()/aggregate() (api/_localmaxxing.js), the upstream cache
// state (/api/health) — it never re-implements any of it:
//
//   - flat, self-describing JSON: `description`, `endpoint`, `generatedAt`,
//     echoed `filters`, a `cache` block, a dataset-wide `dataset` block,
//     per-group `groups[]` each carrying its `confidence` + `freshness`,
//     and a cross-group `summary`;
//   - staleness tiers everywhere mean the same thing as the rest of the API:
//     fresh <90d, aging <1y, stale >=1y, unknown = no parseable date;
//   - confidence is the same 0-100 score used by /api/benchmarks and
//     /api/best (sample size, IQR spread, outlier density), bucketed here
//     into high >=70 / medium >=40 / low <40 grades;
//   - errors keep the shared RFC 9457 problem+json rendering.
//
// Filters mirror the other data endpoints: ?hardware= (substring on rig key
// or label), ?model= (substring on model family or HF id), ?quant= (exact),
// ?context_band=, ?max_age=<days>, ?groupBy=hardware|model|hardwareModel and
// ?snapshot=<id> for reproducible reads.
import { getCacheInfo, aggregate } from '../_localmaxxing.js';
import { resolveRuns } from '../_snapshots.js';
import {
  groupFreshness, stalenessTier, ageInDays,
  filterByMaxAge, parseMaxAgeParam
} from '../_freshness.js';
import { parseContextBandParam, filterByContextBand } from '../_contextbands.js';
import { datasetCaveats } from '../_caveats.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson } from '../_schema.js';
import { sendProblemFromError } from '../_errors.js';

export const config = { runtime: 'nodejs' };

const ENDPOINTS = ['/api/agent/freshness.json', '/api/agent/confidence.json'];

// Thin wrapper over the shared sender so every response carries
// schema_version + X-Schema-Version (see _schema.js / CHANGELOG-API.md).
// The report is derived from the cached dataset — safe to cache briefly.
function json(res, body, status = 200) {
  return sendJson(res, body, { status, cacheTtl: 600 });
}

const DESCRIPTION =
  'Data-freshness and confidence report for the community benchmark dataset. ' +
  'Answers "how old are these numbers and how much should I trust them?" without fetching raw runs: ' +
  'upstream cache state, dataset-wide staleness (tiers: fresh <90d, aging <1y, stale >=1y, unknown = no date), ' +
  'per-group freshness + 0-100 confidence (sample size, IQR spread, outlier density; grades high >=70, medium >=40, low <40), ' +
  'and major engine-release boundary warnings. Identical computations to /api/benchmarks, /api/best and /api/health.';

const RELATED_ENDPOINTS = {
  aggregatedStats: '/api/benchmarks?groupBy=&max_age=',
  rawRuns: '/api/agent/benchmarks.json',
  rankedAnswers: '/api/best?by=decode&model=&quant=',
  serviceHealth: '/api/health',
  snapshots: '/api/snapshots',
  openapiSpec: '/api/spec'
};

/** Confidence grade buckets shared by this endpoint's summary and groups[]. */
export function confidenceGrade(score) {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Shared core (pure): build the freshness/confidence body from an
 * already-resolved run set. Tests drive this directly with synthetic runs;
 * the live handler resolves the dataset first via resolveRuns().
 * Returns { status, body }; ApiErrors bubble to problem+json upstream.
 */
export function buildFreshnessBody(runs, params = {}, { now = new Date(), endpoint = ENDPOINTS[0], snapshot = null } = {}) {
  const q = params;

  // Echoed filters (same semantics as /api/agent/benchmarks.json).
  const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
  const model = q.model ? String(q.model).toLowerCase() : null;
  const quant = q.quant ? String(q.quant).toLowerCase() : null;
  const maxAgeDays = parseMaxAgeParam(q.max_age ?? q.maxAge);
  const contextBand = parseContextBandParam(q.context_band ?? q.contextBand);
  const groupBy = q.groupBy === 'hardware' ? 'hardware'
    : q.groupBy === 'model' ? 'model'
    : 'hardwareModel'; // default: hardware × model family

  const keyFns = {
    hardware: r => r.hardwareKey,
    model: r => r.modelFamily,
    hardwareModel: r => `${r.hardwareKey}|${r.modelFamily}`
  };

  let filtered = runs;
  if (hardware) filtered = filtered.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
  if (model) filtered = filtered.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
  if (quant) filtered = filtered.filter(r => r.quantization?.toLowerCase() === quant);
  if (maxAgeDays) filtered = filterByMaxAge(filtered, maxAgeDays, now);
  filtered = filterByContextBand(filtered, contextBand);

  // ---- Upstream cache state (reuses the /api/health computation) ----
  const c = getCacheInfo();
  const cache = {
    status: c.hasData ? (c.fresh ? 'fresh' : 'stale') : 'empty',
    fetchedAt: c.fetchedAt,
    ageSeconds: c.ageMs == null ? null : Math.round(c.ageMs / 1000),
    ttlSeconds: Math.round(c.ttlMs / 1000),
    rowCount: c.rowCount,
    source: c.upstream
  };

  // ---- Per-run staleness histogram + overall window ----
  const tierCounts = { fresh: 0, aging: 0, stale: 0, unknown: 0 };
  for (const r of filtered) tierCounts[stalenessTier(ageInDays(r.createdAt, now))] += 1;
  const overall = groupFreshness(filtered, now);

  // ---- Per-group confidence + freshness ----
  const groups = aggregate(filtered, keyFns[groupBy])
    .map(g => ({
      key: g.key,
      runs: g.runs,
      models: g.models,
      engines: g.engines,
      mixedEngines: g.mixedEngines,
      confidence: { ...g.confidence, grade: confidenceGrade(g.confidence.score) },
      freshness: {
        newestRunAt: g.freshness.newestRunAt,
        oldestRunAt: g.freshness.oldestRunAt,
        newestAgeDays: g.freshness.newestAgeDays,
        staleness: g.freshness.staleness
      },
      majorReleaseWarnings: g.freshness.majorReleaseWarnings
    }))
    // Least-trustworthy first: an agent reading top-down sees the numbers it
    // should double-check before the ones it can rely on. Key tiebreak keeps
    // the order stable across calls with identical data.
    .sort((a, b) =>
      (a.confidence.score - b.confidence.score)
      || String(a.key).localeCompare(String(b.key)));

  // ---- Cross-group summary ----
  const scores = groups.map(g => g.confidence.score);
  const gradeDist = { high: 0, medium: 0, low: 0 };
  const stalenessDist = { fresh: 0, aging: 0, stale: 0, unknown: 0 };
  for (const g of groups) {
    gradeDist[g.confidence.grade] += 1;
    stalenessDist[g.freshness.staleness] += 1;
  }

  return {
    status: 200,
    body: {
      description: DESCRIPTION,
      endpoint,
      generatedAt: now.toISOString(),
      ...(snapshot ? { snapshot } : {}),
      filters: {
        hardware: q.hardware ?? null,
        model: q.model ?? null,
        quant: q.quant ?? null,
        contextBand: contextBand || null,
        maxAgeDays: maxAgeDays || null,
        groupBy
      },
      cache,
      dataset: {
        totalRuns: filtered.length,
        datedRuns: filtered.length - tierCounts.unknown,
        undatedRuns: tierCounts.unknown,
        stalenessTiers: tierCounts,
        newestRunAt: overall.newestRunAt,
        oldestRunAt: overall.oldestRunAt,
        newestAgeDays: overall.newestAgeDays,
        staleness: overall.staleness,
        majorReleaseWarnings: overall.majorReleaseWarnings
      },
      groups,
      summary: {
        groups: groups.length,
        confidence: {
          meanScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
          minScore: scores.length ? Math.min(...scores) : null,
          maxScore: scores.length ? Math.max(...scores) : null,
          grades: gradeDist
        },
        staleness: stalenessDist
      },
      caveats: [
        ...datasetCaveats(),
        {
          code: 'undated_runs_tier_unknown',
          severity: 'info',
          summary: `${tierCounts.unknown} run(s) carry no parseable measurement date`,
          detail: 'Undated runs are tier "unknown" and are excluded when a ?max_age=<days> filter is requested — an unverifiable date must not pass as fresh.'
        }
      ],
      relatedEndpoints: RELATED_ENDPOINTS
    }
  };
}

/** Resolve the dataset (live or pinned ?snapshot=) and build the report. */
export async function runFreshnessReport(params = {}, opts = {}) {
  const { runs, snapshot } = await resolveRuns(params);
  return buildFreshnessBody(runs, params, { ...opts, snapshot });
}

export default async function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  if ((req.method || 'GET') !== 'GET') {
    return json(res, { error: `Method ${req.method} not allowed. Use GET.` }, 405);
  }

  try {
    const pathname = (req.url || '').split('?')[0];
    const endpoint = ENDPOINTS.find(e => pathname.endsWith(e.slice('/api'.length))) || ENDPOINTS[0];
    const { status, body } = await runFreshnessReport(req.query || {}, { endpoint });
    return json(res, body, status);
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
