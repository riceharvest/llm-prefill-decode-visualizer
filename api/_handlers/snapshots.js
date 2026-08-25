import { listSnapshots, ensureSnapshot } from '../_snapshots.js';
import { applySchemaHeaders, sendJson } from '../_schema.js';
import { sendProblem } from '../_errors.js';
import { enforceRateLimit } from '../_ratelimit.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200) {
  return sendJson(res, body, { status, cacheTtl: 60 });
}

/**
 * GET /api/snapshots — versioned dataset snapshot IDs usable as
 * ?snapshot=<id> on /api/localmaxxing, /api/benchmarks and /api/best.
 * Always resolves the current dataset first so a cold instance publishes
 * at least one snapshot instead of returning an empty list.
 */
export default async function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
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
    // RFC 9457 problem+json (#570); legacy `error` field preserved.
    const detail = String(err.message || err);
    applySchemaHeaders(res);
    return sendProblem(res, req, { status: 502, code: 'UPSTREAM_UNAVAILABLE', detail, error: detail });
  }
}
