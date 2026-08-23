import { getAllRunsRaw } from '../_localmaxxing.js';
import { runsCsvPreamble, toRunsCsv, buildRunsJsonPayload, RUNS_DATASET_VERSION } from '../_runs_dump.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson } from '../_schema.js';
import { ApiError, sendProblemFromError } from '../_errors.js';

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
 *
 * Shares the cached upstream fetch with every other benchmark endpoint, so
 * this dump adds no extra upstream load.
 */
export default async function handler(req, res) {
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

    // Raw cache (10 min TTL) is shared with every other benchmark endpoint,
    // so this dump adds no extra upstream load.
    const all = await getAllRunsRaw();
    const rows = mode === 'all'
      ? all
      : all.filter(r => r.comparable === (mode === 'true'));

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

    const payload = buildRunsJsonPayload(rows, generatedAt, { totalRunCount: all.length, comparableFilter: mode });
    return sendJson(res, payload, { cacheTtl: 600 });
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
