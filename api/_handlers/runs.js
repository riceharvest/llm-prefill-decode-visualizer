import { getAllRunsRaw } from '../_localmaxxing.js';
import {
  runsCsvPreamble,
  toRunsCsv,
  buildRunsJsonPayload,
  buildRunLookupPayload,
  filterRunsByRunId,
  RUNS_DATASET_VERSION
} from '../_runs_dump.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson } from '../_schema.js';
import { ApiError, sendProblem, sendProblemFromError } from '../_errors.js';

export const config = { runtime: 'nodejs' };

const COMPARABLE_MODES = ['all', 'true', 'false'];

/**
 * GET /api/runs — machine-readable dump of the FULL run index.
 *
 * One-shot export of every community-measured run (comparable AND
 * batched/non-comparable) so agents and crawlers can consume the whole
 * dataset without JS, pagination round-trips, or client-side filtering.
 *
 * ?format=json|csv        default json
 * ?comparable=all|true|false  default all — subset on the single-stream flag
 * ?runId=<id> (alias ?id=)    subset to ONE run by its runId instead of
 *                             silently ignoring the param (#767)
 *
 * Shares the cached upstream fetch with every other benchmark endpoint, so
 * this dump adds no extra upstream load.
 */
export default async function handler(req, res) {
  // CORS preflight + method guard (agents/crawlers are first-class consumers).
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendProblem(res, req, {
      code: 'METHOD_NOT_ALLOWED',
      detail: `${req.method} is not supported here. Use GET to fetch the full run index.`
    });
  }

  if (!enforceRateLimit(req, res)) return;

  try {
    const formatParam = req.query?.format ?? 'json';
    if (formatParam !== 'json' && formatParam !== 'csv') {
      throw new ApiError('INVALID_PARAMS', `format must be "json" or "csv", got "${formatParam}"`);
    }
    const mode = req.query?.comparable ?? 'all';
    if (!COMPARABLE_MODES.includes(mode)) {
      throw new ApiError('INVALID_PARAMS', `comparable must be one of ${COMPARABLE_MODES.join('|')}, got "${mode}"`);
    }
    // ?runId= (alias ?id=) — filter the dump to a single run (#767). Never
    // silently ignore the param: an empty value is a loud 400.
    const runIdParam = req.query?.runId ?? req.query?.id;
    if (runIdParam != null && String(runIdParam).trim() === '') {
      throw new ApiError('INVALID_PARAMS', 'runId must be a non-empty run identifier');
    }

    // Raw cache (10 min TTL) is shared with every other benchmark endpoint,
    // so this dump adds no extra upstream load.
    const all = await getAllRunsRaw();
    let rows = mode === 'all'
      ? all
      : all.filter(r => r.comparable === (mode === 'true'));
    if (runIdParam != null) {
      rows = filterRunsByRunId(rows, String(runIdParam).trim());
    }

    const generatedAt = new Date().toISOString();
    const dateTag = generatedAt.slice(0, 10).replaceAll('-', '');

    if (formatParam === 'csv') {
      const suffix = mode === 'true' ? '-comparable' : mode === 'false' ? '-noncomparable' : '';
      res.statusCode = 200;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="localmaxxing-all-runs-v${RUNS_DATASET_VERSION}${suffix}-${dateTag}.csv"`);
      res.write(runsCsvPreamble(rows.length, generatedAt, { comparableFilter: mode }));
      res.write(toRunsCsv(rows));
      return res.end();
    }

    const payload = buildRunsJsonPayload(rows, generatedAt, {
      totalRunCount: all.length,
      comparableCount: all.filter(r => r.comparable).length,
      comparableFilter: mode,
      ...(runIdParam != null ? { runIdFilter: String(runIdParam).trim() } : {})
    });
    return sendJson(res, payload, { cacheTtl: 600 });
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}

/**
 * GET /api/runs/{runId} — single-run lookup (#766).
 *
 * Resolves ONE community-measured run by its runId without downloading the
 * full /api/runs dump. The dispatcher (api/[...path].js) matches the path and
 * forwards the id via ?id=.
 */
export async function runLookup(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendProblem(res, req, {
      code: 'METHOD_NOT_ALLOWED',
      detail: `${req.method} is not supported here. Use GET to fetch a single run by id.`
    });
  }

  if (!enforceRateLimit(req, res)) return;

  try {
    const id = req.query?.id;
    if (id == null || String(id).trim() === '') {
      throw new ApiError('INVALID_PARAMS', 'a non-empty run id path parameter is required');
    }
    const wanted = String(id).trim();
    const all = await getAllRunsRaw();
    const run = all.find(r => String(r.runId) === wanted);
    if (!run) {
      throw new ApiError('NOT_FOUND',
        `no run with runId "${wanted}" — discover ids via GET /api/runs`);
    }
    return sendJson(res, buildRunLookupPayload(run, new Date().toISOString()), { cacheTtl: 600 });
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
