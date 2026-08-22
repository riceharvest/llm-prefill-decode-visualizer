// GET /api/watch/rss.xml?model=&hardware=&quant=&days=N
//
// RSS 2.0 feed of community LocalMaxxing runs matching a watched
// hardware+model combo (#109). Filters mirror GET /api/localmaxxing:
// model/hardware substring match, quant exact. `days` bounds item age
// (default 30, max 365); undated runs are always included.
import { enforceRateLimit } from '../_ratelimit.js';
import { sendProblemFromError } from '../_errors.js';
import { getAllRuns } from '../_localmaxxing.js';
import { buildRssFeed, runsForWatch, RSS_MAX_ITEMS } from '../_watch.js';

export const config = { runtime: 'nodejs' };

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

function parseDays(raw) {
  if (raw == null || raw === '') return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n), MAX_DAYS);
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

    const runs = await getAllRuns();
    const watch = {
      model: q.model ?? null,
      hardware: q.hardware ?? null,
      quant: q.quant ?? null
    };
    let matched = runsForWatch(runs, watch);

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const dated = matched.filter(r => !r.createdAt || new Date(r.createdAt).getTime() >= cutoff);

    // Feed readers key off guid+pubDate; newest first, capped.
    const xml = buildRssFeed({
      runs: dated.slice(0, RSS_MAX_ITEMS),
      title: [watch.hardware, watch.model].filter(Boolean).join(' + ') || 'All combos',
      description: `New single-stream LLM benchmark runs${[watch.hardware, watch.model].filter(Boolean).length ? ` for ${[watch.hardware, watch.model].filter(Boolean).join(' + ')}` : ''} (last ${days} days). Data: localmaxxing.com via llm-prefill-decode-visualizer.`,
      origin: req.headers.host ? `https://${req.headers.host}` : ''
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
    res.setHeader('X-Matched-Runs', String(matched.length));
    return res.end(xml);
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
