// GET /api/runs — machine-readable dump of the FULL run index (every upstream
// run, comparable or not), for agents/crawlers that want the data without JS,
// pagination round-trips or client-side filtering.
//
// Each row carries a boolean `comparable` flag so consumers can apply (or skip)
// the same single-stream comparability filter the aggregated endpoints use,
// instead of re-deriving the rules. The comparable-only views remain available
// at /api/localmaxxing (paginated) and /api/export (download).
//
// Query params:
//   ?format=json|csv      default json — csv is RFC 4180 with a #-comment preamble
//   ?comparable=all|true|false   default all — subset rows by the comparability flag
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson } from '../_schema.js';
import { sendProblemFromError } from '../_errors.js';
import {
  loadRunIndex,
  toRunsCsv,
  runsCsvPreamble,
  buildRunsJsonPayload
} from '../_runs_dump.js';

export const config = { runtime: 'nodejs' };

const COMPARABLE_MODES = new Set(['all', 'true', 'false']);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return sendJson(res, { error: `Method ${req.method} not allowed. Use GET to fetch the full run index.` }, { status: 405 });
  }
  if (!enforceRateLimit(req, res)) return;

  const format = req.query?.format === 'csv' ? 'csv' : 'json';
  const mode = String(req.query?.comparable ?? 'all').toLowerCase();
  if (!COMPARABLE_MODES.has(mode)) {
    return sendJson(res, {
      error: 'Invalid ?comparable= value. Use comparable=true, comparable=false or comparable=all (default).'
    }, { status: 400 });
  }

  try {
    // Raw cache (10 min TTL) is shared with every other benchmark endpoint,
    // so this dump adds no extra upstream load.
    let rows = await loadRunIndex();

    if (mode !== 'all') {
      const want = mode === 'true';
      rows = rows.filter(r => r.comparable === want);
    }

    const generatedAt = new Date().toISOString();
    const comparableOnly = mode === 'true';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=600');

    if (format === 'csv') {
      const dateTag = generatedAt.slice(0, 10).replaceAll('-', '');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="localmaxxing-all-runs-v1-${dateTag}.csv"`);
      res.write(runsCsvPreamble(rows.length, generatedAt, { comparableOnly }));
      res.write(toRunsCsv(rows));
      return res.end();
    }

    return sendJson(res, buildRunsJsonPayload(rows, generatedAt, { comparableOnly }), { cacheTtl: 600 });
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
