import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotStore, hashRows } from './_dataset.js';

const ROWS_A = [{ id: 1, decodeTokPerSec: 100 }];
const ROWS_B = [{ id: 1, decodeTokPerSec: 120 }];
const ROWS_C = [{ id: 2, decodeTokPerSec: 90 }];

function makeStore(rowsSequence, { maxSnapshots = 24, tick = 1000 } = {}) {
  let call = 0;
  let t = 1_700_000_000_000;
  return createSnapshotStore({
    fetchRows: async () => rowsSequence[Math.min(call++, rowsSequence.length - 1)],
    maxSnapshots,
    now: () => (t += tick)
  });
}

test('hashRows is deterministic and content-sensitive', () => {
  assert.equal(hashRows(ROWS_A), hashRows([...ROWS_A]));
  assert.notEqual(hashRows(ROWS_A), hashRows(ROWS_B));
});

test('current() mints a stable id with date + content hash', async () => {
  const store = makeStore([ROWS_A]);
  const snap = await store.current();
  assert.match(snap.id, /^ds-\d{8}-[0-9a-f]{8}$/);
  assert.equal(snap.runCount, 1);
  assert.equal(new Date(snap.buildTimestamp).getTime(), snap.builtAt);
});

test('unchanged data keeps the same version id and build timestamp', async () => {
  const store = makeStore([ROWS_A, ROWS_A, ROWS_A]);
  const first = await store.current();
  const second = await store.current();
  assert.equal(second.id, first.id);
  assert.equal(second.buildTimestamp, first.buildTimestamp);
  assert.equal(store.size, 1);
});

test('changed data mints a new snapshot; old ones stay queryable', async () => {
  const store = makeStore([ROWS_A, ROWS_B]);
  const v1 = await store.current();
  const v2 = await store.current();
  assert.notEqual(v2.id, v1.id);
  assert.equal(store.size, 2);
  assert.deepEqual(store.listSnapshots().map(s => s.id), [v2.id, v1.id]);

  // resolve by exact id and by hash prefix
  assert.equal(store.resolve(v1.id).snapshot.id, v1.id);
  assert.equal(store.resolve(v1.contentHash.slice(0, 8)).snapshot.id, v1.id);
  assert.equal(store.resolve(`ds-${v1.contentHash.slice(0, 8)}`).snapshot.id, v1.id);
});

test('asOf by timestamp resolves to the newest snapshot built at or before it', async () => {
  const store = makeStore([ROWS_A, ROWS_B, ROWS_C], { tick: 60_000 });
  const v1 = await store.current(); // t = 1_700_001_000_000
  const v2 = await store.current(); // t = 1_700_061_000_000
  const v3 = await store.current(); // t = 1_700_121_000_000

  // between v1 and v2 → v1
  assert.equal(store.resolve(new Date(v1.builtAt + 1000).toISOString()).snapshot.id, v1.id);
  // exactly at v2's build time → v2
  assert.equal(store.resolve(new Date(v2.builtAt).toISOString()).snapshot.id, v2.id);
  // after v3 → v3
  assert.equal(store.resolve(new Date(v3.builtAt + 60_000).toISOString()).snapshot.id, v3.id);
  // before anything → no match
  assert.equal(store.resolve(new Date(v1.builtAt - 1000).toISOString()), null);
  // epoch seconds work too
  assert.equal(store.resolve(String(Math.floor(v2.builtAt / 1000))).snapshot.id, v2.id);
});

test('unknown asOf values resolve to null (handler turns that into a 404)', () => {
  const store = makeStore([ROWS_A]);
  assert.equal(store.resolve('nope'), null);
  assert.equal(store.resolve(''), null);
  assert.equal(store.resolve('not-a-date-or-hash'), null);
});

test('maxSnapshots bounds retention, evicting oldest first', async () => {
  const store = makeStore([ROWS_A, ROWS_B, ROWS_C, ROWS_A, ROWS_B], { maxSnapshots: 2 });
  const v1 = await store.current(); // A
  await store.current();            // B
  const v3 = await store.current(); // C
  const v4 = await store.current(); // A again
  const v5 = await store.current(); // B again

  assert.equal(store.size, 2);
  // retention window holds the two most recent contents: B (newest) and A;
  // re-requesting A kept its original id (content-addressed), C was evicted.
  assert.deepEqual(store.listSnapshots().map(s => s.id), [v5.id, v1.id]);
  assert.equal(v4.id, v1.id);
  assert.equal(store.resolve(v3.id), null);
  assert.equal(store.resolve(v1.id).snapshot.id, v1.id);
});

test('upstream failure serves the last good snapshot instead of throwing', async () => {
  let fail = false;
  const store = createSnapshotStore({
    fetchRows: async () => { if (fail) throw new Error('upstream 500'); return ROWS_A; },
    now: () => 1_700_000_000_000
  });
  const good = await store.current();
  fail = true;
  const stale = await store.current();
  assert.equal(stale.id, good.id);
});
