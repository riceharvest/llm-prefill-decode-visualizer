import { getAllRunsRaw } from '../_localmaxxing.js';
import { runsCsvPreamble, toRunsCsv, buildRunsJsonPayload, RUNS_DATASET_VERSION, CSV_BOM } from '../_runs_dump.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson, applyRangeGuard } from '../_schema.js';
import { ApiError, sendProblem, sendProblemFromError } from '../_errors.js';
import { parsePagination, paginate, paginationScope, InvalidCursorError } from '../_pagination.js';
import { requireEnum } from '../_params.js';

export const config = { runtime: 'nodejs' };

const COMPARABLE_MODES = ['all', 'true', 'false'];
// Hard caps so /api/runs can never return the entire multi-MB dump in one
// response (#778): page size defaults to 1000 rows and is clamped to 2000
// (~1.8 MB worst case, comfortably below serverless response ceilings).
// Full-dataset access is a keyset walk over the stable runId order.
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 2000;

// Stable ascending runId total order for the dump's keyset walk (runIds are
// immutable upstream identifiers, so cursors survive dataset refreshes).
const runIdOf = r => String(r.runId ?? '');
const ascStrCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * GET /api/runs — machine-readable dump of the FULL run index.
 *
 * Paginated one-shot-style export of every community-measured run (comparable
 * AND batched/non-comparable) so agents and crawlers can consume the whole
 * dataset without JS or client-side filtering. Responses are hard-capped at
 * MAX_LIMIT rows; follow next_cursor until has_more is false for the rest.
 *
 * ?format=json|csv        default json
 * ?comparable=all|true|false  default all — subset on the single-stream flag
 * ?limit=N                default 1000, max 2000 rows per page
 * ?cursor=<opaque>        next_cursor from the previous page (keyset on runId)
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

  // Ranged GETs bypass the CDN cache (#995): a cached body sliced by the edge
  // into a 200-branded partial response is indistinguishable from the full
  // dump for clients that only check the status code.
  const ranged = applyRangeGuard(req, res);

  try {
    // Shared strict enum contract (see _params.js requireEnum): unknown
    // values are a 400 problem+json on BOTH dataset endpoints — /api/export
    // no longer silently coerces them to CSV (#728). Case-insensitive +
    // whitespace-tolerant, so "JSON" or "json " still work.
    const formatParam = requireEnum(req.query?.format, ['json', 'csv'], 'format', 'json');
    const mode = requireEnum(req.query?.comparable, COMPARABLE_MODES, 'comparable', 'all');

    // Cursors carry a fingerprint of format + comparable filter + schema
    // version (#740 #755), so stale/mismatched reuse fails loudly instead of
    // silently resuming into the wrong slice of the dataset.
    const scope = paginationScope('runs', {
      format: formatParam,
      comparable: mode,
      datasetVersion: RUNS_DATASET_VERSION
    });
    const q = req.query || {};
    const { limit, cursor } = parsePagination(q, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT, scope });

    // Raw cache (10 min TTL) is shared with every other benchmark endpoint,
    // so this dump adds no extra upstream load.
    const all = await getAllRunsRaw();
    let rows = mode === 'all'
      ? all
      : all.filter(r => r.comparable === (mode === 'true'));
    rows = [...rows].sort((a, b) => ascStrCmp(runIdOf(a), runIdOf(b)));

    const page = paginate({ items: rows, limit, cursor, keyOf: runIdOf, cmp: ascStrCmp, scope });

    const generatedAt = new Date().toISOString();
    const dateTag = generatedAt.slice(0, 10).replaceAll('-', '');

    if (formatParam === 'csv') {
      const suffix = mode === 'true' ? '-comparable' : mode === 'false' ? '-noncomparable' : '';
      res.statusCode = 200;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', ranged ? 'no-store' : 'public, max-age=600');
      if (ranged) res.setHeader('Accept-Ranges', 'none');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="localmaxxing-all-runs-v${RUNS_DATASET_VERSION}${suffix}-${dateTag}.csv"`);
      // UTF-8 BOM first so Excel decodes the em-dashes in the `#` preamble
      // correctly; preamble + table are LF-terminated (see toRunsCsv).
      res.write(CSV_BOM);
      res.write(runsCsvPreamble(rows.length, generatedAt, { comparableFilter: mode }));
      res.write(toRunsCsv(page.items));
      if (page.has_more) {
        res.write(`# truncated: showing ${page.items.length} of ${rows.length} rows (limit=${limit})\r\n`);
        res.write(`# continue the walk: /api/runs?format=csv&comparable=${mode}&limit=${limit}&cursor=${page.next_cursor}\r\n`);
      }
      return res.end();
    }

    const payload = {
      ...buildRunsJsonPayload(page.items, generatedAt, {
        totalRunCount: all.length,
        comparableCount: all.filter(r => r.comparable).length,
        comparableFilter: mode
      }),
      // rowCount stays the TOTAL number of matching rows; returnedRows is the
      // page actually served (#778 — never silently equate the two again).
      rowCount: rows.length,
      pagination: {
        limit,
        returnedRows: page.items.length,
        hasMore: page.has_more,
        nextCursor: page.next_cursor,
        note: 'Responses are hard-capped; follow next_cursor until hasMore is false for the full dataset.'
      },
      has_more: page.has_more,
      next_cursor: page.next_cursor
    };
    return sendJson(res, payload, { cacheTtl: 600 });
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return sendProblem(res, req, { status: 400, code: 'INVALID_CURSOR', detail: err.message });
    }
    return sendProblemFromError(res, req, err);
  }
}
