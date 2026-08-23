// GET /api/agent/crosscheck.json — agent-friendly cross-rig consistency report
// over the community benchmark dataset, reusing the exact cross-check engine
// the rest of the API uses (api/_crosscheck.js): multi-GPU rigs are compared
// against the single-GPU baseline of the same model family × quantization,
// and every cohort carries the shared data-quality confidence block.
//
// Design goals for agents:
//   - one call answers "which community submissions look wrong": every rig
//     cohort is checked, and cohorts carrying contradictions sort first;
//   - flat, self-describing JSON: `description`, echoed `filters`, and both
//     contradiction kinds spelled out inline (`contradictionKinds`);
//   - every contradiction is ALSO hoisted to a top-level `contradictions`
//     array tagged with its cohort key, so an agent skimming the summary
//     never has to walk every group to find them;
//   - the shared items pagination contract (?limit= / ?cursor=) so huge
//     datasets stay scannable page by page.
//
// Filters mirror /api/agent/benchmarks.json and /api/agent/freshness.json:
// ?hardware= (substring on rig key or label), ?model= (substring on model
// family or HF id), ?quant= (exact), plus ?context_band=, ?max_age=,
// ?limit=, ?cursor= and ?snapshot=. Default cohorts are same-engine
// (rig × engine build); ?crossEngine=true merges across engine builds,
// matching /api/benchmarks.
import { resolveRuns } from '../_snapshots.js';
import { parsePagination, paginate, descNumAscStrCmp, InvalidCursorError } from '../_pagination.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson } from '../_schema.js';
import { sendProblem, sendProblemFromError } from '../_errors.js';
import { confidence, crossCheck } from '../_crosscheck.js';
import { filterByMaxAge, parseMaxAgeParam } from '../_freshness.js';
import { parseContextBandParam, filterByContextBand } from '../_contextbands.js';
import { engineTag, matchesEngineQuery } from '../_engine.js';

export const config = { runtime: 'nodejs' };

// Thin wrapper over the shared sender so every response carries
// schema_version + X-Schema-Version (see _schema.js / CHANGELOG-API.md).
function json(res, body, status = 200) {
  return sendJson(res, body, { status, cacheTtl: 600 });
}

// Default cohort: one rig (hardware key) on one engine build — the unit
// inside which crossCheck buckets by model family × quantization and
// compares multi-GPU subsets against the single-GPU baseline.
// ?crossEngine=true merges across engine builds, matching /api/benchmarks.
export function keyFnFor(crossEngine) {
  return crossEngine
    ? (r => r.hardwareKey)
    : (r => `${r.hardwareKey}|${engineTag(r)}`);
}

/**
 * Compact flat per-cohort cross-check shape: identifying fields plus the
 * confidence block and the shared crossCheck result (relatedRigComparisons +
 * contradictions) inlined one level deep.
 */
export function toAgentCrosscheckGroup(key, members) {
  const cc = crossCheck(members);
  return {
    key,
    hardware: members[0]?.hardware ?? members[0]?.hardwareKey ?? key,
    models: [...new Set(members.map(r => r.modelFamily))],
    runsInGroup: members.length,
    confidence: confidence(members),
    relatedRigComparisons: cc.relatedRigComparisons,
    contradictions: cc.contradictions
  };
}

/**
 * Hoist every cohort's contradictions into one flat list, each entry tagged
 * with the cohort `key` it came from (deduped by identity of position).
 */
export function hoistContradictions(items) {
  const out = [];
  for (const g of items) {
    for (const c of g.contradictions) {
      out.push({ group: g.key, ...c });
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  try {
    const q = req.query || {};

    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    const model = q.model ? String(q.model).toLowerCase() : null;
    const quant = q.quant ? String(q.quant).toLowerCase() : null;
    const engineQ = q.engine ? String(q.engine) : null;

    const snapshotAt = new Date();
    const maxAgeDays = parseMaxAgeParam(q.max_age ?? q.maxAge);
    const contextBand = parseContextBandParam(q.context_band ?? q.contextBand);

    const { runs: liveRuns, snapshot } = await resolveRuns(q);
    let runs = liveRuns;

    // Same filter semantics as search_runs / GET /api/agent/benchmarks.json.
    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);
    if (engineQ) runs = runs.filter(r => matchesEngineQuery(r, engineQ));
    if (maxAgeDays) runs = filterByMaxAge(runs, maxAgeDays, snapshotAt);
    runs = filterByContextBand(runs, contextBand);

    const crossEngine = ['1', 'true', 'yes'].includes(String(q.crossEngine).toLowerCase());
    const keyFn = keyFnFor(crossEngine);

    // Group membership first, then one cross-check per cohort.
    const groups = new Map();
    for (const run of runs) {
      const k = keyFn(run);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(run);
    }

    const { limit, cursor } = parsePagination(q, { defaultLimit: 25, maxLimit: 200 });

    // Cohorts with contradictions first (most flagged wins), then most
    // comparisons done, then key asc. descNumAscStrCmp orders numbers
    // descending and strings ascending, so plain counts give the order.
    const GROUP_KEY = g => [
      g.contradictions.length,
      g.relatedRigComparisons,
      g.key
    ];
    const items = [...groups.entries()].map(([key, members]) => toAgentCrosscheckGroup(key, members));
    items.sort((a, b) => descNumAscStrCmp(GROUP_KEY(a), GROUP_KEY(b)));
    const page = paginate({ items, limit, cursor, keyOf: GROUP_KEY, cmp: descNumAscStrCmp });

    return json(res, {
      description: 'Cross-rig consistency report over the community benchmark dataset: every hardware(+engine) cohort is checked for multi-GPU submissions that contradict the single-GPU baseline on the same model family and quantization. Contradiction kinds: slower_than_single (multi-GPU rig reports less TOTAL throughput than the single-card median — likely misconfigured run) and poor_scaling (per-GPU throughput below 50% of baseline — plausible for CPU-bound setups but suspicious). Each cohort also carries a data-quality confidence block (runs, IQR spread %, outliers, recency, grade). Filter with ?hardware=<rig substring>&model=<model family or HF id substring>&quant=<exact quant>&context_band=lt1k|1k-8k|8k-32k|32k+&max_age=<days>; merge across engine builds with ?crossEngine=true. Cohorts are sorted most-suspicious-first with cursor pagination (follow next_cursor until has_more is false); every contradiction is also listed in the top-level contradictions array tagged with its cohort.',
      endpoint: '/api/agent/crosscheck.json',
      snapshot,
      generatedAt: snapshotAt.toISOString(),
      filters: {
        hardware: q.hardware ?? null,
        model: q.model ?? null,
        quant: q.quant ?? null,
        contextBand: contextBand || null,
        maxAgeDays: maxAgeDays || null,
        crossEngine
      },
      contradictionKinds: {
        slower_than_single: 'multi-GPU rig reports less total tok/s than the single-card median on the same model+quant — likely misconfigured submission',
        poor_scaling: 'per-GPU decode is below 50% of the single-card baseline — plausible for CPU/Ring-bottlenecked setups but suspicious enough to flag'
      },
      overall: {
        runsInDataset: runs.length,
        cohortsChecked: items.length,
        cohortsWithContradictions: items.filter(g => g.contradictions.length).length,
        relatedRigComparisons: items.reduce((n, g) => n + g.relatedRigComparisons, 0),
        contradictions: items.reduce((n, g) => n + g.contradictions.length, 0)
      },
      note: 'a clean report does not mean the data is right — it means no multi-GPU submission contradicts its single-GPU baseline yet; judge per-cohort trust with the confidence block (grade low|medium|high) and pair with /api/agent/freshness.json before citing numbers as current',
      total: items.length,
      count: page.items.length,
      items: page.items,
      contradictions: hoistContradictions(items),
      has_more: page.has_more,
      next_cursor: page.next_cursor,
      relatedEndpoints: {
        rawRuns: '/api/agent/benchmarks.json',
        perGroupConfidence: '/api/agent/confidence.json',
        freshness: '/api/agent/freshness.json',
        aggregatedStats: '/api/benchmarks?groupBy=hardwareModel&crossEngine=true',
        openapiSpec: '/api/spec'
      }
    });
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return sendProblem(res, req, { status: 400, code: 'INVALID_CURSOR', detail: err.message });
    }
    return sendProblemFromError(res, req, err);
  }
}
