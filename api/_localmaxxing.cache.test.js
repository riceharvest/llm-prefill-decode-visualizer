// Cache-refresh + stale-marker behavior of getDataset() (issues #1076, #855).
//
// #1076: cache.promise used to stay set forever after a successful fetch, so
// the TTL branch was unreachable and every instance served its first load
// indefinitely. #855: serving stale rows after a failed refresh was completely
// undetectable — now the result (and snapshot metadata) carry a marker.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const UPSTREAM_ROWS_A = [upstreamRow('a1', 4000, 110), upstreamRow('a2', 3900, 105)];
const UPSTREAM_ROWS_B = [upstreamRow('b1', 5000, 130), upstreamRow('b2', 4800, 125)];

function upstreamRow(id, prefill, decode) {
  return {
    id,
    createdAt: '2026-08-01T00:00:00Z',
    batchSize: 1,
    engineFlags: {},
    tokSPrefill: prefill,
    tokSOut: decode,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    model: { hfId: 'test/org-7b', displayName: 'Org 7B', params: 7 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b4000', quantization: 'q4_k_m' },
    hardwareGroupKey: 'rtx-4090',
    hardwareGroupLabel: 'RTX 4090',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 }
  };
}

async function freshModule() {
  // Dynamic import per test is not enough to reset module state (module cache),
  // so rely on invalidateCache() between tests instead.
  const mod = await import('./_localmaxxing.js');
  const snapshots = await import('./_snapshots.js');
  mod.invalidateCache();
  snapshots.resetSnapshots();
  return { mod, snapshots };
}

test('#1076: the dataset actually refreshes once the TTL expires', async () => {
  const { mod } = await freshModule();
  let rows = UPSTREAM_ROWS_A;
  const fetchMock = mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => ({ rows }) }));
  try {
    const first = await mod.getDataset();
    assert.equal(first.rows.length, 2);
    assert.equal(first.rows[0].decodeTokPerSec, 110);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(first.stale, undefined);

    // Advance past the 10-minute TTL and change the upstream data.
    rows = UPSTREAM_ROWS_B;
    // Date.now is read directly by the TTL check; emulate expiry by backdating
    // nothing and instead shifting the clock forward around the call.
    const second = await (async () => {
      const realNow = Date.now;
      Date.now = () => realNow() + 11 * 60 * 1000;
      try {
        return await mod.getDataset();
      } finally {
        Date.now = realNow;
      }
    })();

    assert.equal(fetchMock.mock.callCount(), 2, 'expected a second upstream fetch after TTL expiry');
    assert.equal(second.rows[0].decodeTokPerSec, 130, 'rows must come from the NEW upstream payload');
    assert.ok(second.fetchedAt > first.fetchedAt);
    assert.equal(second.stale, undefined);
  } finally {
    fetchMock.mock.restore();
  }
});

test('#1076: concurrent waiters on the same in-flight refresh share one fetch', async () => {
  const { mod } = await freshModule();
  const fetchMock = mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => ({ rows: UPSTREAM_ROWS_A }) }));
  try {
    const [a, b] = await Promise.all([mod.getDataset(), mod.getDataset()]);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(a.rows.map(r => r.runId), b.rows.map(r => r.runId));
  } finally {
    fetchMock.mock.restore();
  }
});

test('#855: a failed refresh past the TTL serves stale rows flagged stale:true', async () => {
  const { mod } = await freshModule();
  let fail = false;
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ rows: UPSTREAM_ROWS_A }) };
  });
  try {
    const good = await mod.getDataset();
    assert.equal(good.stale, undefined);

    fail = true; // upstream outage past the TTL
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;
    let stale;
    try {
      stale = await mod.getDataset();
    } finally {
      Date.now = realNow;
    }

    assert.equal(stale.stale, true, 'stale serve must be flagged');
    assert.deepEqual(stale.rows.map(r => r.runId), good.rows.map(r => r.runId));
    assert.equal(stale.fetchedAt, good.fetchedAt);

    // Recovery: once the upstream answers again, the flag disappears.
    fail = false;
    Date.now = () => realNow() + 22 * 60 * 1000;
    let recovered;
    try {
      recovered = await mod.getDataset();
    } finally {
      Date.now = realNow;
    }
    assert.equal(recovered.stale, undefined);
    assert.ok(recovered.fetchedAt > stale.fetchedAt);
  } finally {
    fetchMock.mock.restore();
  }
});

test('#855: concurrent waiters get the stale fallback instead of a raw rejection', async () => {
  const { mod } = await freshModule();
  let fail = false;
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ rows: UPSTREAM_ROWS_A }) };
  });
  try {
    await mod.getDataset();
    fail = true;
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;
    try {
      const results = await Promise.all([mod.getDataset(), mod.getDataset(), mod.getDataset()]);
      for (const r of results) {
        assert.equal(r.stale, true);
        assert.equal(r.rows.length, 2);
      }
    } finally {
      Date.now = realNow;
    }
  } finally {
    fetchMock.mock.restore();
  }
});

test('#855: cold-cache failure with no cached rows still throws UPSTREAM_UNAVAILABLE', async () => {
  const { mod } = await freshModule();
  const fetchMock = mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503, json: async () => ({}) }));
  try {
    await assert.rejects(() => mod.getDataset(), /UPSTREAM_UNAVAILABLE|HTTP 503|leaderboard/);
  } finally {
    fetchMock.mock.restore();
  }
});

test('#855: snapshot metadata carries datasetStale when built from stale rows', async () => {
  const { snapshots } = await freshModule();
  let fail = false;
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ rows: UPSTREAM_ROWS_A }) };
  });
  try {
    const live = await snapshots.ensureSnapshot();
    assert.equal(live.snapshot.datasetStale, undefined);

    fail = true;
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;
    let degraded;
    try {
      degraded = await snapshots.ensureSnapshot();
    } finally {
      Date.now = realNow;
    }
    assert.equal(degraded.snapshot.datasetStale, true);
    // The public snapshot listing surfaces the same marker.
    const listed = snapshots.listSnapshots().find(s => s.id === degraded.snapshot.id);
    assert.equal(listed.datasetStale, true);
  } finally {
    fetchMock.mock.restore();
  }
});
