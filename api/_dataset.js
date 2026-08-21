// Dataset versioning + point-in-time snapshots for the agent-facing API.
//
// Wraps the _localmaxxing.js row cache in an immutable, content-addressed
// snapshot store. Every time the underlying rows change we mint a new
// snapshot (stable id = date + content hash); unchanged data keeps the
// same id, so a cited answer stays reproducible across warm invocations.
// Point-in-time queries (?asOf=<id|version|timestamp>) resolve against
// snapshots retained on this instance (bounded list, newest first).

import crypto from 'node:crypto';
import { getAllRuns } from './_localmaxxing.js';

/** Content hash for a set of rows (order-sensitive, cheap, stable). */
export function hashRows(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function shortHash(hex) {
  return hex.slice(0, 8);
}

/**
 * Snapshot store factory. Injectable fetcher + clock keep it unit-testable
 * without network access.
 */
export function createSnapshotStore({
  fetchRows = getAllRuns,
  maxSnapshots = 24,
  now = () => Date.now()
} = {}) {
  let snapshots = []; // newest first: { id, version, buildTimestamp, builtAt, contentHash, runCount, rows }
  let inflight = null;

  function build(rows) {
    const builtAt = now();
    const contentHash = hashRows(rows);
    return {
      id: `ds-${new Date(builtAt).toISOString().slice(0, 10).replaceAll('-', '')}-${shortHash(contentHash)}`,
      contentHash,
      buildTimestamp: new Date(builtAt).toISOString(),
      builtAt,
      runCount: rows.length,
      rows
    };
  }

  /** Current snapshot: refreshes upstream rows; re-mints only when content changed. */
  async function current() {
    if (inflight) return inflight;
    inflight = (async () => {
      const rows = await fetchRows();
      const fresh = build(rows);
      if (snapshots[0]?.contentHash === fresh.contentHash) {
        // Same content — keep the original id/build timestamp so cited
        // versions remain stable while the cache refreshes underneath.
        return snapshots[0];
      }
      snapshots.unshift(fresh);
      if (snapshots.length > maxSnapshots) snapshots.length = maxSnapshots;
      return fresh;
    })();
    try {
      return await inflight;
    } catch (err) {
      if (!snapshots.length) throw err;
      return snapshots[0]; // serve stale rather than fail
    } finally {
      inflight = null;
    }
  }

  /**
   * Resolve an ?asOf= value to a snapshot:
   *   - exact snapshot id or content-hash prefix ("ds-20260821-a1b2c3d4", "a1b2c3d4")
   *   - ISO date/datetime or epoch seconds/ms → newest snapshot built at or before that time
   * Returns { snapshot, asOf } or null when nothing matches.
   */
  function resolve(asOfRaw) {
    const asOf = String(asOfRaw).trim();
    if (!asOf) return null;
    const needle = asOf.toLowerCase().replace(/^ds-/, '');
    const byId = snapshots.find(s =>
      s.id.toLowerCase() === needle ||
      s.id.toLowerCase() === `ds-${needle}` ||
      shortHash(s.contentHash) === needle
    );
    if (byId) return { snapshot: byId, asOf };

    let t = Date.parse(asOf);
    if (!Number.isFinite(t)) {
      const n = Number(asOf);
      if (!Number.isFinite(n)) return null;
      t = n < 1e12 ? n * 1000 : n; // epoch seconds vs ms
    }
    const older = snapshots.filter(s => s.builtAt <= t);
    if (!older.length) return null;
    return { snapshot: older[0], asOf }; // snapshots are newest-first
  }

  /** Snapshot summaries (no rows) — used for 404 hints and /api/meta-style output. */
  function listSnapshots() {
    return snapshots.map(({ id, buildTimestamp, runCount, contentHash }) => ({
      id,
      buildTimestamp,
      runCount,
      contentHash: shortHash(contentHash)
    }));
  }

  return {
    current,
    resolve,
    listSnapshots,
    get size() { return snapshots.length; }
  };
}

/** Shared instance used by all data endpoints. */
export const datasetStore = createSnapshotStore();
