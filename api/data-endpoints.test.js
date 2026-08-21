import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotStore } from './_dataset.js';
import localmaxxing, { handlerWith as localmaxxingWith } from './localmaxxing.js';
import benchmarks, { handlerWith as benchmarksWith } from './benchmarks.js';
import best, { handlerWith as bestWith } from './best.js';

// Rows shaped like _localmaxxing.slim() output so aggregation math runs.
function row(n, decode) {
  return {
    runId: n,
    modelFamily: 'llama',
    modelId: `test/llama-${n}`,
    modelName: 'Llama Test',
    paramsB: 8,
    hardwareKey: `rig-${n}`,
    hardware: `Rig ${n}`,
    hwClass: 'discrete_gpu',
    gpu: 'RTX 4090',
    gpuCount: 1,
    vramGb: 24,
    engine: 'llama.cpp',
    quantization: 'q4_k_m',
    prefillTokPerSec: 3000,
    decodeTokPerSec: decode
  };
}

const V1 = [row(1, 100), row(2, 80)];
const V2 = [row(1, 110), row(2, 85), row(3, 60)]; // dataset changed

function makeStore(rowsSequence) {
  let call = 0;
  let t = 1_700_000_000_000;
  return createSnapshotStore({
    fetchRows: async () => rowsSequence[Math.min(call++, rowsSequence.length - 1)],
    now: () => (t += 30_000)
  });
}

function call(handlerFn, store, { query = {}, headers = {} } = {}) {
  const req = { method: 'GET', query, headers };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  const result = handlerFn(store, req, res);
  return Promise.resolve(result).then(() => ({
    status: res.statusCode,
    etag: res.headers.ETag,
    json: res.body ? JSON.parse(res.body) : null
  }));
}

for (const [name, handlerFn] of [['localmaxxing', localmaxxingWith], ['benchmarks', benchmarksWith], ['best', bestWith]]) {

  test(`${name}: response carries dataset version + build timestamp`, async () => {
    const store = makeStore([V1]);
    const { status, json } = await call(handlerFn, store);
    assert.equal(status, 200);
    assert.match(json.dataset.version, /^ds-\d{8}-[0-9a-f]{8}$/);
    assert.equal(json.dataset.runCount, 2);
    assert.equal(json.dataset.asOf, null);
    assert.equal(new Date(json.dataset.buildTimestamp).getTime(), new Date(store.listSnapshots()[0].buildTimestamp).getTime());
  });

  test(`${name}: ?asOf= replays a cached snapshot for point-in-time results`, async () => {
    const store = makeStore([V1, V2]);
    const v1 = (await call(handlerFn, store)).json.dataset.version;
    await call(handlerFn, store); // mint V2

    const replay = await call(handlerFn, store, { query: { asOf: v1 } });
    assert.equal(replay.status, 200);
    assert.equal(replay.json.dataset.version, v1);
    assert.equal(replay.json.dataset.asOf, v1);

    // numbers come from the old snapshot, not the current one
    if (handlerFn === localmaxxingWith) assert.equal(replay.json.totalComparableRuns, 2);
    if (handlerFn === benchmarksWith) assert.equal(replay.json.matchedRuns, 2);
    if (handlerFn === bestWith) assert.equal(replay.json.matchedRuns, 2);

    // an ISO-timestamp between the two builds also resolves to the older snapshot
    const stamps = store.listSnapshots().map(s => new Date(s.buildTimestamp).getTime()); // newest first
    const midway = new Date(Math.floor((stamps[0] + stamps[1]) / 2)).toISOString();
    const byTime = await call(handlerFn, store, { query: { asOf: midway } });
    assert.equal(byTime.status, 200);
    assert.equal(byTime.json.dataset.version, v1);
  });

  test(`${name}: unknown asOf is a 404 listing available snapshots`, async () => {
    const store = makeStore([V1]);
    const { status, json } = await call(handlerFn, store, { query: { asOf: 'bogus-123' } });
    assert.equal(status, 404);
    assert.match(json.error, /No cached dataset snapshot/);
    assert.ok(Array.isArray(json.snapshots));
  });

  test(`${name}: ETag + If-None-Match round-trips to 304`, async () => {
    let seq = V1;
    const store = createSnapshotStore({
      fetchRows: async () => seq,
      now: (() => { let t = 1_700_000_000_000; return () => (t += 30_000); })()
    });
    const first = await call(handlerFn, store, {});
    const second = await call(handlerFn, store, { headers: { 'if-none-match': first.etag } });
    assert.equal(second.status, 304);
    assert.equal(second.json, null);

    // dataset changed → different ETag → fresh 200 even with the old validator
    seq = V2;
    const staleValidator = await call(handlerFn, store, { headers: { 'if-none-match': first.etag } });
    assert.equal(staleValidator.status, 200);
    assert.notEqual(staleValidator.etag, first.etag);
  });
}

test('default exports still work standalone (production wiring intact)', async () => {
  // These hit the real datasetStore/network only when invoked; here we just
  // verify the module surface didn't regress.
  assert.equal(typeof localmaxxing, 'function');
  assert.equal(typeof benchmarks, 'function');
  assert.equal(typeof best, 'function');
});
