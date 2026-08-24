// Dataset-layer tests for api/_localmaxxing.js:
// - #1076: the 10-minute TTL must actually trigger a refetch after expiry
//   (cache.promise used to stay settled forever, freezing the dataset).
// - #1090: a crawl that stops on a full page at the offset hard cap must
//   surface `truncated` instead of failing silently.

import { test, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { getDataset, getCacheInfo, invalidateCache } from './_localmaxxing.js';

const PAGE = 200; // upstream page size (module-private constant)

function upstreamRow(id) {
  return {
    id,
    createdAt: '2026-08-01T00:00:00.000Z',
    batchSize: 1,
    engineFlags: { concurrency: 1 },
    tokSPrefill: 1000 + id,
    tokSOut: 50 + id / 10,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    model: { hfId: `org/model-${id}`, displayName: `Model ${id}`, params: 8 },
    hardwareGroupKey: 'rtx-4090',
    hardwareGroupLabel: 'RTX 4090',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b1' }
  };
}

/** Fetch stub serving one array per call (call N gets pages[N]). */
function fetcher(pagesPerCall) {
  let call = 0;
  return async () => {
    const rows = pagesPerCall[Math.min(call++, pagesPerCall.length - 1)];
    return { ok: true, json: async () => ({ rows }) };
  };
}

let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  invalidateCache();
});

after(() => {
  globalThis.fetch = realFetch;
});

test('#1076: getDataset refetches once past CACHE_TTL_MS (TTL is not dead code)', async () => {
  mock.timers.enable({ apis: ['Date'] });
  try {
    const T0 = 1_700_000_000_000;
    mock.timers.setTime(T0);
    globalThis.fetch = fetcher([[upstreamRow(1)]]);
    const first = await getDataset();
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].runId, 1);
    assert.equal(first.fetchedAt, T0);

    // Past the TTL the upstream serves different data; the cache MUST refresh.
    mock.timers.setTime(T0 + 10 * 60 * 1000 + 1);
    globalThis.fetch = fetcher([[upstreamRow(2), upstreamRow(3)]]);
    const second = await getDataset();
    assert.equal(second.rows.length, 2, 'post-TTL call must refetch from upstream');
    assert.equal(second.rows[0].runId, 2);
  } finally {
    mock.timers.reset();
    globalThis.fetch = realFetch;
  }
});

test('#1076: within TTL the cached rows are served without hitting upstream', async () => {
  mock.timers.enable({ apis: ['Date'] });
  try {
    const T0 = 1_700_000_000_000;
    mock.timers.setTime(T0);
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, json: async () => ({ rows: [upstreamRow(1)] }) };
    };
    await getDataset();
    assert.equal(calls, 1);

    mock.timers.setTime(T0 + 5 * 60 * 1000); // still fresh
    const again = await getDataset();
    assert.equal(calls, 1, 'fresh window must not refetch');
    assert.equal(again.rows[0].runId, 1);
  } finally {
    mock.timers.reset();
    globalThis.fetch = realFetch;
  }
});

test('#1090: a full final page at the offset cap marks the dataset truncated', async () => {
  // Every page full → crawl stops at the cap with more rows likely upstream.
  globalThis.fetch = fetcher([Array.from({ length: PAGE }, (_, i) => upstreamRow(i + 1))]);
  const result = await getDataset();
  assert.equal(result.truncated, true);
  assert.equal(getCacheInfo().truncated, true);
  // 101 pages × 200 rows all land in the raw index.
  assert.equal(result.rows.length, PAGE * 101);
});

test('#1090: a short final page before the cap is NOT truncated', async () => {
  globalThis.fetch = fetcher([
    Array.from({ length: PAGE }, (_, i) => upstreamRow(i + 1)), // full first page
    [upstreamRow(999)] // short second page → clean end of data
  ]);
  const result = await getDataset();
  assert.equal(result.truncated, false);
  assert.equal(getCacheInfo().truncated, false);
});

test('#1090: truncated flag resets with invalidateCache()', async () => {
  globalThis.fetch = fetcher([Array.from({ length: PAGE }, (_, i) => upstreamRow(i + 1))]);
  await getDataset();
  assert.equal(getCacheInfo().truncated, true);
  invalidateCache();
  assert.equal(getCacheInfo().truncated, false);
});
