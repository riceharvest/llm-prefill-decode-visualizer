// GET /api/agent/benchmarks.json — agent-friendly wrapper around the raw
// community benchmark run search (the same data/functionality the MCP
// `search_runs` tool exposes via GET /api/localmaxxing).
//
// Design goals for agents:
//   - flat, self-describing JSON: every response carries a `description`,
//     echoed `filters`, per-run units are implicit in the field names
//     (*TokPerSec), and each run is stamped with ageDays/staleness;
//   - stable ordering (fastest decode first, runId tiebreak) + cursor
//     pagination identical to the rest of the API (items contract);
//   - pointers to the related endpoints so an agent can escalate from raw
//     runs to aggregated stats (/api/benchmarks), ranked answers (/api/best)
//     or reproducible snapshots (?snapshot=).
//
// Filters mirror search_runs exactly: ?hardware= (substring on rig key or
// label), ?model= (substring on model family or HF id), ?quant= (exact),
// plus the shared ?context_band=, ?max_age=, ?limit=, ?cursor= and
// ?snapshot= parameters.
import { resolveRuns } from '../_snapshots.js';
import { parsePagination, paginate, descNumAscStrCmp, InvalidCursorError, paginationScope } from '../_pagination.js';
import { normalizeQueryModel } from '../_normalize.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson } from '../_schema.js';
import { sendProblem, sendProblemFromError } from '../_errors.js';
import { decorateRun, filterByMaxAge, parseMaxAgeParam } from '../_freshness.js';
import { parseContextBandParam, filterByContextBand } from '../_contextbands.js';
import { runsCaveats } from '../_caveats.js';

export const config = { runtime: 'nodejs' };

// Thin wrapper over the shared sender so every response carries
// schema_version + X-Schema-Version (see _schema.js / CHANGELOG-API.md).
function json(res, body, status = 200) {
  return sendJson(res, body, { status, cacheTtl: 600 });
}

// Stable total order: fastest decode first, runId as unique tiebreak
// (same ordering contract as GET /api/localmaxxing).
const RUN_KEY = r => [r.decodeTokPerSec, String(r.runId)];

/**
 * Compact flat per-run shape for agents: one level deep, no nested hardware /
 * engine objects, speeds in tok/s baked into the field names, measurement
 * date plus derived freshness fields attached.
 */
export function toAgentRun(run) {
  return {
    runId: run.runId,
    model: run.modelName || run.modelId || run.modelFamily,
    modelId: run.modelId ?? null,
    modelFamily: run.modelFamily,
    paramsB: run.paramsB ?? null,
    hardware: run.hardware,
    hardwareKey: run.hardwareKey,
    hwClass: run.hwClass ?? null,
    quantization: run.quantization ?? null,
    engine: run.engine ?? null,
    engineVersion: run.engineVersion ?? null,
    prefillTokPerSec: run.prefillTokPerSec,
    decodeTokPerSec: run.decodeTokPerSec,
    contextLength: run.contextLength ?? null,
    contextBand: run.contextBand ?? null,
    measuredAt: run.createdAt ?? null,
    ageDays: run.ageDays,
    staleness: run.staleness,
    source: run.source ?? null
  };
}

export default async function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  try {
    const q = req.query || {};

    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    const model = q.model ? normalizeQueryModel(q.model) : null;
    const quant = q.quant ? String(q.quant).toLowerCase() : null;

    const snapshotAt = new Date();
    const maxAgeDays = parseMaxAgeParam(q.max_age ?? q.maxAge);
    const contextBand = parseContextBandParam(q.context_band ?? q.contextBand);

    const { runs: liveRuns, snapshot } = await resolveRuns(q);
    let runs = liveRuns;

    // Same filter semantics as search_runs / GET /api/localmaxxing.
    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);
    if (maxAgeDays) runs = filterByMaxAge(runs, maxAgeDays, snapshotAt);
    runs = filterByContextBand(runs, contextBand);

    // Cursor fingerprinting (#740 #755) — same scoping as /api/localmaxxing.
    const scope = paginationScope('agent_benchmarks', {
      hardware, model, quant,
      maxAgeDays: maxAgeDays ?? '',
      contextBand: contextBand ?? '',
      snapshot: snapshot?.id ?? ''
    });
    const { limit, cursor } = parsePagination(q, { defaultLimit: 25, maxLimit: 200, scope });

    runs.sort((a, b) => descNumAscStrCmp(RUN_KEY(a), RUN_KEY(b)));
    const page = paginate({ items: runs, limit, cursor, keyOf: RUN_KEY, cmp: descNumAscStrCmp, scope });

    return json(res, {
      description: 'Community-measured single-stream LLM benchmark runs (one record per measured hardware+model+quant+engine combination, from localmaxxing.com). Speeds are tok/s. Filter with ?hardware=<rig substring>&model=<model family or HF id substring>&quant=<exact quant>&context_band=lt1k|1k-8k|8k-32k|32k+&max_age=<days>. Runs are sorted fastest decode first with cursor pagination (follow next_cursor until has_more is false); staleness tiers: fresh <90d, aging <1y, stale >=1y. For medians + confidence use /api/benchmarks, for ranked answers /api/best.',
      endpoint: '/api/agent/benchmarks.json',
      snapshot,
      generatedAt: snapshotAt.toISOString(),
      filters: {
        hardware: q.hardware ?? null,
        model: q.model ?? null,
        quant: q.quant ?? null,
        contextBand: contextBand || null,
        maxAgeDays: maxAgeDays || null
      },
      total: runs.length,
      count: page.items.length,
      runs: page.items.map(r => toAgentRun(decorateRun(r, snapshotAt))),
      has_more: page.has_more,
      next_cursor: page.next_cursor,
      caveats: runsCaveats(runs),
      relatedEndpoints: {
        aggregatedStats: '/api/benchmarks?model=&quant=&groupBy=hardwareModel',
        rankedAnswers: '/api/best?by=decode&model=&quant=',
        rawRuns: '/api/localmaxxing?hardware=&model=&quant=',
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
