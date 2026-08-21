import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock the upstream leaderboard BEFORE imports so nothing hits the network.
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
const ROWS_A = [row('a1', 'riga', 100), row('a2', 'rigb', 90)];
const ROWS_B = [row('a1', 'riga', 100), row('a2', 'rigb', 90), row('a3', 'rigc', 80)];

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS_A }) });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const {
  computeSnapshotId, ensureSnapshot, getSnapshot, resolveRuns, resetSnapshots
} = await import('./_snapshots.js');
const { invalidateCache } = await import('./_localmaxxing.js');
const { default: snapshotsHandler } = await import('./snapshots.js');

beforeEach(() => {
  invalidateCache();
  resetSnapshots();
});

// ---------- computeSnapshotId ----------

test('snapshot ID is deterministic for the same run set + bucket', () => {
  const t = 1_758_400_000_000; // fixed ms timestamp
  assert.equal(computeSnapshotId(['a', 'b'], t), computeSnapshotId(['a', 'b'], t));
});

test('snapshot ID ignores run order (content-addressed)', () => {
  const t = 1_758_400_000_000;
  assert.equal(computeSnapshotId(['b', 'a', 'c'], t), computeSnapshotId(['c', 'a', 'b'], t));
});

test('snapshot ID changes when the run set changes', () => {
  const t = 1_758_400_000_000;
  assert.notEqual(computeSnapshotId(['a', 'b'], t), computeSnapshotId(['a', 'b', 'c'], t));
});

test('snapshot ID changes across fetch-time buckets', () => {
  const t = 1_758_400_000_000;
  assert.notEqual(computeSnapshotId(['a', 'b'], t), computeSnapshotId(['a', 'b'], t + 600_000));
});

test('snapshot ID has the documented snapshot-YYYY-MM-DD-<hex> shape', () => {
  // 1758400000000 ms → 2025-09-20 UTC (in a 10-min bucket starting that day).
  const id = computeSnapshotId(['a'], 1_758_400_000_000);
  assert.match(id, /^snapshot-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);
  assert.ok(id.startsWith('snapshot-2025-09-20-'), id);
});

// ---------- store + resolveRuns ----------

async function currentSnapshotId() {
  const { snapshot } = await ensureSnapshot();
  return snapshot.id;
}

test('ensureSnapshot publishes the live dataset under a stable ID', async () => {
  const id = await currentSnapshotId();
  const snap = getSnapshot(id);
  assert.ok(snap, 'snapshot should be registered');
  assert.equal(snap.runCount, 2);
  assert.equal(snap.runs.length, 2);
  assert.ok(snap.createdAt);
  // Second resolution within the same cache window reuses the same ID.
  assert.equal(await currentSnapshotId(), id);
});

test('?snapshot=<known id> serves frozen runs even after upstream changes', async () => {
  const id = await currentSnapshotId();

  // Upstream now returns a different dataset.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS_B }) });
  invalidateCache();

  const { runs, snapshot } = await resolveRuns({ snapshot: id });
  assert.equal(snapshot.served, true);
  assert.equal(snapshot.id, id);
  assert.equal(runs.length, 2, 'pinned snapshot must not include the new run');
  assert.ok(runs.every(r => ['a1', 'a2'].includes(r.runId)));
});

test('?snapshot=<unknown id> falls back to live data with served:false', async () => {
  const { runs, snapshot } = await resolveRuns({ snapshot: 'snapshot-2020-01-01-00000000' });
  assert.equal(snapshot.served, false);
  assert.equal(snapshot.requested, 'snapshot-2020-01-01-00000000');
  assert.ok(snapshot.note);
  assert.equal(runs.length, 2); // live ROWS_A
});

test('no ?snapshot= resolves to the current snapshot', async () => {
  const { runs, snapshot } = await resolveRuns({});
  assert.ok(snapshot.id);
  assert.equal(snapshot.served, undefined);
  assert.equal(runs.length, 2);
});

test('snapshot ring evicts oldest beyond capacity', async () => {
  let n = 0;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [row(`x${++n}`, 'rigx', 100)] })
  });
  for (let i = 0; i < 17; i++) {
    invalidateCache(); // force a refetch (and thus a new run set) each round
    await ensureSnapshot();
  }
  // 16 kept, the very first must be gone.
  assert.equal(getSnapshot('x1'), null);
  const first = await currentSnapshotId();
  assert.ok(getSnapshot(first), 'most recent snapshot must survive');
});

// ---------- /api/snapshots handler ----------

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

test('GET /api/snapshots lists the current snapshot with usable IDs', async () => {
  const res = mockRes();
  await snapshotsHandler({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.match(body.current, /^snapshot-/);
  assert.ok(Array.isArray(body.snapshots) && body.snapshots.length >= 1);
  assert.ok(body.snapshots.some(s => s.id === body.current));
  // The listed ID must actually resolve as a pin.
  const pinned = await resolveRuns({ snapshot: body.current });
  assert.equal(pinned.snapshot.served, true);
});
