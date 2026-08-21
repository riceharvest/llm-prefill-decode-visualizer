// GET /api/health — liveness + upstream data freshness for the status page.
// Cheap by design: reports cache state only, never blocks on upstream fetches.
import { getCacheInfo } from './_localmaxxing.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body, null, 2));
}

export default function handler(req, res) {
  try {
    const c = getCacheInfo();
    const ageSeconds = c.ageMs == null ? null : Math.round(c.ageMs / 1000);
    const upstreamFreshness = {
      // fresh: within TTL · stale: older than TTL but serving · empty: no data yet
      status: c.hasData ? (c.fresh ? 'fresh' : 'stale') : 'empty',
      fetchedAt: c.fetchedAt,
      ageSeconds,
      ttlSeconds: Math.round(c.ttlMs / 1000),
      rowCount: c.rowCount,
      source: c.upstream
    };
    return json(res, {
      ok: true,
      service: 'llm-prefill-decode-visualizer',
      time: new Date().toISOString(),
      upstreamFreshness,
      cacheAge: ageSeconds
    });
  } catch (err) {
    return json(res, {
      ok: false,
      service: 'llm-prefill-decode-visualizer',
      time: new Date().toISOString(),
      error: String((err && err.message) || err)
    }, 500);
  }
}
