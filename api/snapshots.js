import { listSnapshots, ensureSnapshot } from './_snapshots.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200, cacheTtl = 60) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `public, max-age=${cacheTtl}`);
  res.end(JSON.stringify(body, null, 2));
}

/**
 * GET /api/snapshots — versioned dataset snapshot IDs usable as
 * ?snapshot=<id> on /api/localmaxxing, /api/benchmarks and /api/best.
 * Always resolves the current dataset first so a cold instance publishes
 * at least one snapshot instead of returning an empty list.
 */
export default async function handler(req, res) {
  try {
    const { snapshot: current } = await ensureSnapshot();
    const snapshots = listSnapshots();
    if (!snapshots.some(s => s.id === current.id)) snapshots.unshift(current);
    return json(res, {
      description: 'Content-addressed dataset snapshots. Pin any data endpoint with ?snapshot=<id> for reproducible results. Snapshot IDs are stable for identical run sets within a fetch-time bucket; instances keep a bounded in-memory ring, so old IDs may expire.',
      current: current.id,
      snapshots
    });
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 502);
  }
}
