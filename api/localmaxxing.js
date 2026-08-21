import { getAllRuns } from './_localmaxxing.js';
import { normalizeModelId } from './_normalize.js';
import { parsePagination, paginate, descNumAscStrCmp, InvalidCursorError } from './_pagination.js';
import { validateSubmission, checkDuplicates, queueSubmission } from './_submit.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.end(JSON.stringify(body, null, 2));
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
      ...(dup.similar ? { warnings: [{ code: 'similar_run_exists', message: 'Other runs exist for this model+quant+rig combination at different speeds.', existingRun: dup.similar }] } : {})
    }, 202);
  } catch (err) {
    return json(res, { error: 'queue_unavailable', message: String(err.message || err) }, 503);
  }
}

/**
 * GET /api/localmaxxing — raw comparable runs (flattened, normalized).
 * POST /api/localmaxxing — submit a run for review (validated, queued).
 * GET: ?hardware=<substr> &model=<substr> &quant=<exact> &engine=<substr> &limit=N (default 50, max 500) &cursor=<opaque>
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

  try {
    const q = req.query || {};

    let runs = await getAllRuns();

    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    const model = q.model ? String(q.model).toLowerCase() : null;
    const quant = q.quant ? String(q.quant).toLowerCase() : null;
    const engine = q.engine ? String(q.engine).toLowerCase() : null;

    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);
    if (engine) runs = runs.filter(r => r.engineTag?.toLowerCase().includes(engine));

    if (!hardware && !model && !quant && !engine) {
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
        description: 'Community-measured single-stream LLM benchmark runs. Filter with ?hardware=&model=&quant=&limit=&cursor= for paginated runs. Aggregated stats: /api/benchmarks. Ranked answers: /api/best.',
        totalComparableRuns: runs.length,
        hardwareGroups: [...groups.values()]
          .sort((a, b) => b.runs - a.runs)
          .map(g => ({
            hardware: g.hardware, hardwareKey: g.hardwareKey, hwClass: g.hwClass,
            runs: g.runs, distinctModelFamilies: g.modelFamilies.size
          }))
      });
    }

    let { limit, cursor } = parsePagination(q, { defaultLimit: 50, maxLimit: 500 });

    // Stable total order: fastest decode first, runId as unique tiebreak
    runs.sort((a, b) => descNumAscStrCmp(RUN_KEY(a), RUN_KEY(b)));

    const page = paginate({ items: runs, limit, cursor, keyOf: RUN_KEY, cmp: descNumAscStrCmp });

    return json(res, {
      description: 'Raw comparable runs (modelFamily collapses repo/quant variants of the same base model). Cursor pagination: follow next_cursor until has_more is false.',
      total: runs.length,
      items: page.items,
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
