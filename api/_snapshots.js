// Versioned, content-addressed dataset snapshots (issue #20).
//
// A snapshot ID is derived from the sorted set of run IDs in the dataset plus
// the fetch-time bucket, so identical data within a bucket always maps to the
// same stable ID (e.g. `snapshot-2026-08-21-a1b2c3d4`). Snapshots are kept in
// an in-memory ring per serverless instance — no external storage — which is
// enough for an agent to pin a query with ?snapshot=<id> and get reproducible
// numbers back while the instance is warm.

import { createHash } from 'node:crypto';
import { getDataset } from './_localmaxxing.js';

// Bucket aligned with the upstream cache TTL: within one TTL window the
// underlying rows cannot change, so the same bucket + same run set ⇒ same ID.
const BUCKET_MS = 10 * 60 * 1000;
const HASH_CHARS = 8;
const MAX_SNAPSHOTS = 16;

/** id -> { id, createdAt, runCount, runs } — insertion-ordered ring buffer. */
const snapshots = new Map();

/**
 * Stable snapshot ID for a set of run IDs fetched at `fetchedAt`.
 * Pure and order-insensitive: shuffling the input IDs changes nothing.
 */
export function computeSnapshotId(runIds, fetchedAt) {
  return idForBucket(runIds, Math.floor(fetchedAt / BUCKET_MS));
}

function idForBucket(runIds, bucket) {
  const digest = createHash('sha256')
    .update(JSON.stringify({ bucket, runIds: [...runIds].sort() }))
    .digest('hex')
    .slice(0, HASH_CHARS);
  const day = new Date(bucket * BUCKET_MS).toISOString().slice(0, 10);
  return `snapshot-${day}-${digest}`;
}

// How many recent buckets the content-hash fallback scans when an unknown
// ?snapshot= id arrives (issue #564): snapshot ids minted by a sibling
// serverless instance are not in this instance's in-memory ring, but the ID
// is a pure content hash — if it matches the live run set under any recent
// bucket, serving the live rows IS reproducible and the pin can be honored.
const HASH_FALLBACK_BUCKETS = 6;

/**
 * Content-hash fallback (#564): does `id` equal the content-addressed ID of
 * the given run set for any recent bucket? `times` are ms timestamps whose
 * buckets to scan (callers pass both "now" and the dataset's own fetch time,
 * since a warm instance's dataset may be older than the scan window).
 * A match proves the requested run set is byte-identical to the live one,
 * so honoring the pin changes nothing about reproducibility.
 */
export function matchLiveSnapshot(id, runIds, times) {
  const wanted = String(id || '');
  const list = Array.isArray(runIds) ? runIds : null;
  if (!wanted || !list || list.length === 0) return false;
  const bases = (Array.isArray(times) ? times : [times])
    .filter(t => Number.isFinite(t))
    .map(t => Math.floor(t / BUCKET_MS));
  for (const base of [...new Set(bases)]) {
    for (let k = 0; k < HASH_FALLBACK_BUCKETS; k++) {
      if (idForBucket(list, base - k) === wanted) return true;
    }
  }
  return false;
}

function publicMeta(snap) {
  return { id: snap.id, createdAt: snap.createdAt, runCount: snap.runCount };
}

/**
 * Resolve the current dataset to a snapshot: computes the content-addressed
 * ID for the live rows and registers them if the ID is not yet stored.
 * Returns `{ snapshot, runs }` where `snapshot` is the public metadata.
 */
export async function ensureSnapshot() {
  const { rows, fetchedAt } = await getDataset();
  const id = computeSnapshotId(rows.map(r => r.runId), fetchedAt);
  let snap = snapshots.get(id);
  if (!snap) {
    snap = {
      id,
      createdAt: new Date(fetchedAt).toISOString(),
      runCount: rows.length,
      runs: rows
    };
    snapshots.set(id, snap);
    // Evict oldest once over capacity.
    while (snapshots.size > MAX_SNAPSHOTS) {
      snapshots.delete(snapshots.keys().next().value);
    }
  }
  return { snapshot: publicMeta(snap), runs: rows };
}

/** Look up a previously published snapshot by ID. Null when unknown/expired. */
export function getSnapshot(id) {
  return snapshots.get(String(id || '')) || null;
}

/** Public metadata for every live snapshot, newest first. */
export function listSnapshots() {
  return [...snapshots.values()].reverse().map(publicMeta);
}

/**
 * Dataset resolution shared by the data endpoints:
 * - no ?snapshot=  → current dataset + its snapshot metadata
 * - known ?snapshot= → the pinned snapshot's frozen runs (reproducible)
 * - unknown ?snapshot= → current dataset, with served:false so callers can tell
 */
export async function resolveRuns(q = {}) {
  const requested = q.snapshot ? String(q.snapshot) : null;
  if (requested) {
    const snap = getSnapshot(requested);
    if (snap) {
      return { runs: snap.runs, snapshot: { ...publicMeta(snap), requested, served: true } };
    }
    const live = await ensureSnapshot();
    // Content-hash fallback (#564): a freshly minted snapshot id can miss the
    // in-memory ring (cold instance, sibling serverless instance, ring
    // eviction). The id is a pure hash of the run set — when it matches the
    // live rows, serving them IS the pinned data, so honor the pin.
    const { fetchedAt } = await getDataset();
    if (matchLiveSnapshot(requested, live.runs.map(r => r.runId), [Date.now(), fetchedAt])) {
      return {
        runs: live.runs,
        snapshot: { ...live.snapshot, requested, served: true, matchedBy: 'content-hash' }
      };
    }
    return {
      runs: live.runs,
      snapshot: {
        ...live.snapshot,
        requested,
        served: false,
        note: 'requested snapshot is not stored on this instance; serving current data instead'
      }
    };
  }
  const live = await ensureSnapshot();
  return { runs: live.runs, snapshot: live.snapshot };
}

/** Test hook: drop all stored snapshots. */
export function resetSnapshots() {
  snapshots.clear();
}
