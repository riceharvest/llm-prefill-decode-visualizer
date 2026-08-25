import { listSnapshots, ensureSnapshot } from '../_snapshots.js';
import { sendJson } from '../_schema.js';
import { listEnvelope } from '../_pagination.js';

export const config = { runtime: 'nodejs' };

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
    // Shared list envelope (#951): collection under `items` + one top-level
    // `total`; `snapshots` stays as a deprecation-window alias. Routed
    // through the single shared sender (#963) so the schema version is
    // stamped like on every other endpoint.
    return sendJson(res, listEnvelope({
      description: 'Content-addressed dataset snapshots. Pin any data endpoint with ?snapshot=<id> for reproducible results. Snapshot IDs are stable for identical run sets within a fetch-time bucket; instances keep a bounded in-memory ring, so old IDs may expire.',
      current: current.id,
      items: snapshots,
      aliases: { snapshots }
    }), { cacheTtl: 60 });
  } catch (err) {
    return sendJson(res, { error: String(err.message || err) }, { status: 502 });
  }
}
