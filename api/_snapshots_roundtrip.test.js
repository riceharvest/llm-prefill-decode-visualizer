// #564: snapshot ids minted by data endpoints must be re-pinnable.
// The in-memory ring loses ids across instances/evictions; the content-hash
// fallback lets a fresh instance honor a pin whose id matches the live run set.
//
// Run: node --test api/_snapshots_roundtrip.test.js

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function row(id, rig, decode) {
  return {
    id, batchSize: 1,
    tokSPrefill: 2000, tokSOut: decode,
    model: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B', params: 8 },
    hardwareGroupKey: rig, hardwareGroupLabel: rig.toUpperCase(),
    hardware: { hwClass: 'discrete_gpu', gpuName: `GPU ${rig}`, gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
  };
}
const ROWS = [row('a1', 'riga', 100), row('a2', 'rigb', 90), row('a3', 'rigc', 80)];

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS }) });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const {
  computeSnapshotId, matchLiveSnapshot, ensureSnapshot, resolveRuns,
  getSnapshot, resetSnapshots
} = await import('./_snapshots.js');
const { invalidateCache } = await import('./_localmaxxing.js');

beforeEach(() => {
  invalidateCache();
  resetSnapshots();
});

test('a freshly minted snapshot id still resolves after the ring is wiped (#564 repro)', async () => {
  const { snapshot } = await ensureSnapshot();
  const minted = snapshot.id;
  assert.match(minted, /^snapshot-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);

  // Simulate a cold/sibling serverless instance: same cached dataset (same
  // rows ⇒ same content hash) but an empty in-memory ring.
  resetSnapshots();
  assert.equal(getSnapshot(minted), null);

  const pinned = await resolveRuns({ snapshot: minted });
  assert.equal(pinned.snapshot.served, true, 'freshly issued id must round-trip');
  assert.equal(pinned.snapshot.requested, minted);
  assert.equal(pinned.snapshot.matchedBy, 'content-hash');
  assert.equal(pinned.runs.length, 3);
});

test('matchLiveSnapshot honors recent-bucket ids and rejects foreign ones', () => {
  const now = Date.now();
  const current = computeSnapshotId(['r1', 'r2'], now);
  const older = computeSnapshotId(['r1', 'r2'], now - 25 * 60 * 1000); // ~2 buckets back
  assert.equal(matchLiveSnapshot(current, ['r2', 'r1'], [now]), true);
  assert.equal(matchLiveSnapshot(older, ['r1', 'r2'], [now]), true, 'recent past bucket within scan window');
  assert.equal(matchLiveSnapshot('snapshot-2020-01-01-00000000', ['r1', 'r2'], [now]), false);
  assert.equal(matchLiveSnapshot(current, ['different'], [now]), false);
  assert.equal(matchLiveSnapshot('', ['r1'], [now]), false);
  assert.equal(matchLiveSnapshot(current, [], [now]), false);
});

test('an id minted from a DIFFERENT run set is still refused (served:false)', async () => {
  // Id for the current rows...
  const stale = computeSnapshotId(ROWS.map(r => r.id), Date.now());
  // ...then upstream changes and both ring + cache are fresh.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: [row('b1', 'rigx', 50)] }) });
  invalidateCache();
  resetSnapshots();

  const res = await resolveRuns({ snapshot: stale });
  assert.equal(res.snapshot.served, false, 'hash of a different run set must not be honored');
  assert.ok(res.snapshot.note);
});
