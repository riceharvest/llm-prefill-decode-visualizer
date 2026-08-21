import { getAllRuns } from './_localmaxxing.js';
import { runsCaveats } from './_caveats.js';
import { resolveRuns, listSnapshots } from './_snapshots.js';
import { normalizeModelId } from './_normalize.js';
import { parsePagination, paginate, descNumAscStrCmp, InvalidCursorError } from './_pagination.js';
import { validateSubmission, checkDuplicates, queueSubmission } from './_submit.js';
import { enforceRateLimit } from './_ratelimit.js';
import { sendJson } from './_schema.js';
import { sendProblem, sendProblemFromError } from './_errors.js';
import { decorateRun, filterByMaxAge, groupFreshness, parseMaxAgeParam } from './_freshness.js';
import { parseContextBandParam, filterByContextBand } from './_contextbands.js';

export const config = { runtime: 'nodejs' };

// Thin wrapper over the shared sender so every response carries
// schema_version + X-Schema-Version (see _schema.js / CHANGELOG-API.md).
function json(res, body, status = 200) {
  return sendJson(res, body, { status, cacheTtl: 600 });
}

// Shared pagination contract (see ./_pagination.js): ?limit=N (default 50, max
// 500) + opaque &cursor=; responses carry items[], has_more, next_cursor, total.
const RUN_KEY = r => [r.decodeTokPerSec, String(r.runId)];

/**
 * POST /api/localmaxxing — submit a community benchmark run for review.
 * Validates required fields (model, quant, hardware, hwClass, prefill/decode
 * tok/s), applies per-hardware-class sanity bounds, checks for duplicates
 * against existing runs, and queues the submission — it is never published
 * without manual review. Validation failures return 400 with machine-readable
 * errors: { error: 'validation_failed', errors: [{ field, code, message }] }.
 */
async function handlePost(req, res) {
  const body = req.body;
  const { ok, errors, submission } = validateSubmission(body);

  if (!ok) {
    return json(res, { error: 'validation_failed', errors }, 400);
  }

  // Duplicate / near-duplicate detection against the existing dataset.
  let dup = { duplicate: null, similar: null };
  try {
    dup = checkDuplicates(submission, await getAllRuns());
  } catch {
    // Dataset unavailable — queue anyway; review catches the rest.
  }
  if (dup.duplicate) {
    return json(res, {
      error: 'duplicate_run',
      message: 'A near-identical run (same model family, quant and rig within 10% on both speeds) already exists.',
      errors: [{ field: 'run', code: 'duplicate', message: `matches existing run ${dup.duplicate.runId}` }],
      existingRun: dup.duplicate
    }, 409);
  }

  try {
    const record = await queueSubmission(submission);
    return json(res, {
      description: 'Run accepted and queued for manual review. It will appear in GET /api/localmaxxing only after approval.',
      status: 'queued',
      reviewStatus: record.reviewStatus,
      submissionId: record.submissionId,
      // Unit-consistency audit is advisory: flagged runs are still queued for
      // review, but the submitter sees why a reviewer might reject (#43).
      ...(submission.unitAudit && !submission.unitAudit.ok
        ? {
            unitAudit: submission.unitAudit,
            warnings: [{
              code: 'unit_audit_flags',
              message: `Speeds look unit-inconsistent (${submission.unitAudit.flags.map(f => f.code).join(', ')}) — queued, but likely to be rejected on review.`
            }]
          }
        : {}),
      ...(dup.similar ? { warnings: [{ code: 'similar_run_exists', message: 'Other runs exist for this model+quant+rig combination at different speeds.', existingRun: dup.similar }] } : {})
    }, 202);
  } catch (err) {
    return json(res, { error: 'queue_unavailable', message: String(err.message || err) }, 503);
  }
}

/**
 * GET /api/localmaxxing — raw comparable runs (flattened, normalized).
 * POST /api/localmaxxing — submit a run for review (validated, queued).
 * GET: ?hardware=<substr> &model=<substr> &quant=<exact> &context_band=lt1k|1k-8k|8k-32k|32k+ &limit=N (default 50, max 500) &cursor=<opaque>
 * &max_age=<days> excludes runs measured longer than N days ago (undated runs dropped)
 * Bare call returns the hardware-group summary.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method === 'POST') {
    try {
      return await handlePost(req, res);
    } catch (err) {
      return json(res, { error: String(err.message || err) }, 500);
    }
  }
  if (req.method !== 'GET') {
    return json(res, { error: `Method ${req.method} not allowed. Use GET to query runs or POST to submit one.` }, 405);
  }

  if (!enforceRateLimit(req, res)) return;
  try {
    const q = req.query || {};

    const snapshotAt = new Date();
    const maxAgeDays = parseMaxAgeParam(q.max_age ?? q.maxAge);
    const contextBand = parseContextBandParam(q.context_band ?? q.contextBand);

    const resolved = await resolveRuns(q);
    let runs = resolved.runs;
    const { snapshot } = resolved;

    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    const model = q.model ? String(q.model).toLowerCase() : null;
    const quant = q.quant ? String(q.quant).toLowerCase() : null;

    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);
    if (maxAgeDays) runs = filterByMaxAge(runs, maxAgeDays, snapshotAt);
    runs = filterByContextBand(runs, contextBand);

    if (!hardware && !model && !quant) {
      // Summary: hardware groups with run counts and freshness metadata
      const groups = new Map();
      for (const r of runs) {
        if (!groups.has(r.hardwareKey)) {
          groups.set(r.hardwareKey, {
            hardware: r.hardware, hardwareKey: r.hardwareKey, hwClass: r.hwClass,
            runs: [], modelFamilies: new Set()
          });
        }
        const g = groups.get(r.hardwareKey);
        g.runs.push(r);
        g.modelFamilies.add(r.modelFamily);
      }
      return json(res, {
        description: 'Community-measured single-stream LLM benchmark runs. Filter with ?hardware=&model=&quant=&context_band=&max_age=&limit=&cursor= for paginated runs. Aggregated stats: /api/benchmarks. Ranked answers: /api/best.',
        snapshot,
        snapshotAt: snapshotAt.toISOString(),
        maxAgeDays: maxAgeDays || null,
        contextBand: contextBand || null,
        totalComparableRuns: runs.length,
        caveats: runsCaveats(runs),
        hardwareGroups: [...groups.values()]
          .sort((a, b) => b.runs.length - a.runs.length)
          .map(g => {
            const freshness = groupFreshness(g.runs, snapshotAt);
            return {
              hardware: g.hardware, hardwareKey: g.hardwareKey, hwClass: g.hwClass,
              runs: g.runs.length, distinctModelFamilies: g.modelFamilies.size,
              staleness: freshness.staleness,
              newestRunAt: freshness.newestRunAt
            };
          })
      });
    }

    let { limit, cursor } = parsePagination(q, { defaultLimit: 50, maxLimit: 500 });

    // Stable total order: fastest decode first, runId as unique tiebreak
    runs.sort((a, b) => descNumAscStrCmp(RUN_KEY(a), RUN_KEY(b)));

    const page = paginate({ items: runs, limit, cursor, keyOf: RUN_KEY, cmp: descNumAscStrCmp });

    return json(res, {
      description: 'Raw comparable runs (modelFamily collapses repo/quant variants of the same base model). Cursor pagination: follow next_cursor until has_more is false. Each run carries createdAt/ageDays/staleness, engineVersion and its contextBand (<1k, 1k–8k, 8k–32k or 32k+; null when the run reports no context length).',
      snapshot,
      snapshotAt: snapshotAt.toISOString(),
      maxAgeDays: maxAgeDays || null,
      contextBand: contextBand || null,
      total: runs.length,
      caveats: runsCaveats(runs),
      items: page.items.map(r => decorateRun(r, snapshotAt)),
      has_more: page.has_more,
      next_cursor: page.next_cursor
    });
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return sendProblem(res, req, { status: 400, code: 'INVALID_CURSOR', detail: err.message });
    }
    return sendProblemFromError(res, req, err);
  }
}
