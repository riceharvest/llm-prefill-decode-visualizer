// GET /api/watch/rss.xml?model=&hardware=&quant=&days=N&page=N&perPage=N
//
// RSS 2.0 feed of community LocalMaxxing runs matching a watched
// hardware+model combo (#109). Filters mirror GET /api/localmaxxing:
// model/hardware substring match, quant exact. `days` bounds item age
// (default 30, max 365); undated runs are always included.
//
// Agent polling affordances (#696):
// - `page` (1-based) x `perPage` cursor pagination — items beyond the first
//   page stay reachable even for combos with hundreds of matches.
// - Deterministic `ETag` (hash of the page's GUID list); `If-None-Match` is
//   honored with a body-less 304 so unchanged polls cost almost nothing.
// - `Last-Modified` reflects the newest matching run's createdAt.
// - `X-Matched-Runs` is the post-days-filter, pre-cap match count.
import { enforceRateLimit } from '../_ratelimit.js';
import { sendProblemFromError } from '../_errors.js';
import { getAllRuns } from '../_localmaxxing.js';
import { buildRssFeed, runsForWatch, rssEtag, RSS_MAX_ITEMS } from '../_watch.js';

export const config = { runtime: 'nodejs' };

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const MAX_PER_PAGE = RSS_MAX_ITEMS;

function parseDays(raw) {
  if (raw == null || raw === '') return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n), MAX_DAYS);
}

function parsePositiveInt(raw, fallback, max) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, max);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method not allowed');
  }
  if (!enforceRateLimit(req, res)) return;

  try {
    const q = req.query || {};
    const days = parseDays(q.days);
    if (days == null) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('?days= must be a non-negative number of days (max 365)');
    }
    const perPage = parsePositiveInt(q.perPage, RSS_MAX_ITEMS, MAX_PER_PAGE);
    const page = perPage == null ? null : parsePositiveInt(q.page, 1, 10_000);
    if (perPage == null || page == null) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('?page= and ?perPage= must be positive integers (perPage max 50)');
    }

    const runs = await getAllRuns();
    const watch = {
      model: q.model ?? null,
      hardware: q.hardware ?? null,
      quant: q.quant ?? null
    };
    let matched = runsForWatch(runs, watch);

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    // Undated runs always pass the age filter; they sort last and carry an
    // epoch pubDate so guid-based clients stay stable (#696).
    const dated = matched.filter(r => !r.createdAt || new Date(r.createdAt).getTime() >= cutoff);

    // Cursor pagination over the filtered set, newest first.
    const start = (page - 1) * perPage;
    const pageItems = dated.slice(start, start + perPage);

    const label = [watch.hardware, watch.model].filter(Boolean).join(' + ') || 'All combos';
    const origin = req.headers.host ? `https://${req.headers.host}` : '';
    const pageSuffix = (page > 1 || perPage !== RSS_MAX_ITEMS)
      ? ` — page ${page} (${perPage}/page)`
      : '';
    const xml = buildRssFeed({
      runs: pageItems,
      title: label,
      description: `New single-stream LLM benchmark runs${label !== 'All combos' ? ` for ${label}` : ''} (last ${days} days). Data: localmaxxing.com via llm-prefill-decode-visualizer.${pageSuffix}`,
      origin
    });

    // Deterministic change detection: hash the page's GUIDs (+ match count).
    const etag = await rssEtag(
      pageItems.map(r => r.runId),
      dated.length
    );
    const newestDatedAt = dated.reduce((acc, r) => {
      const t = r.createdAt ? new Date(r.createdAt).getTime() : NaN;
      return Number.isFinite(t) && t > acc ? t : acc;
    }, 0);

    res.setHeader('ETag', etag);
    if (newestDatedAt > 0) {
      res.setHeader('Last-Modified', new Date(newestDatedAt).toUTCString());
    }
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').map(s => s.trim().replace(/^W\//, '')).includes(etag)) {
      res.statusCode = 304;
      res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
      res.setHeader('X-Matched-Runs', String(dated.length));
      return res.end();
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
    // Post-days-filter, pre-cap match count — the number of items the feed
    // could ever show across all pages (#696).
    res.setHeader('X-Matched-Runs', String(dated.length));
    return res.end(xml);
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
