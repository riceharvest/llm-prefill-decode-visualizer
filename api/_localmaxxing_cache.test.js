// Regression tests for the shared LocalMaxxing dataset cache (#1076, #1090):
// - the 10-minute TTL must actually cause a post-TTL upstream refetch
//   (cache.promise used to stay resolved forever, freezing the dataset);
// - hitting the crawl offset cap must be observable via getCacheInfo()
//   instead of silently truncating the dataset.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDataset, getAllRunsRaw, getCacheInfo, invalidateCache } from './_localmaxxing.js';

const REAL_DATE_NOW = Date.now;
const PAGE = 200;
const TTL_MS = 10 * 60 * 1000;

let now;
let fetchCalls;
let pageSource; // async (offset) => rows[]

function upstreamRun(id) {
  return {
    id,
    batchSize: 1,
    tokSPrefill: 4000,
    tokSOut: 100,
    model: { hfId: 'org/model-7b', displayName: 'Model 7B', params: 7 },
    hardwareGroupKey: 'rtx-4090',
    hardwareGroupLabel: 'RTX 4090',
    hardware: { hwClass: 'gpu', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b1', quantization: 'q4_k_m' },
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    createdAt: '2026-08-01T00:00:00.000Z'
  };
}

function stubFetch() {
  fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    const offset = Number(new URL(url).searchParams.get('offset'));
    const rows = await pageSource(offset);
    return { ok: true, json: async () => ({ rows }) };
  };
}

function startTest({ initialPages }) {
  now = REAL_DATE_NOW.call(Date);
  Date.now = () => now; // controllable clock for TTL expiry
  pageSource = initialPages;
  stubFetch();
  invalidateCache();
}

afterEach(() => {
  Date.now = REAL_DATE_NOW;
  delete globalThis.fetch;
});

test('post-TTL getDataset() refetches upstream (#1076 regression)', async () => {
  startTest({ initialPages: async () => [upstreamRun('r1')] });
  const first = await getDataset();
  assert.equal(fetchCalls.length, 1);
  assert.equal(first.rows[0].runId, 'r1');
  const fetchedAtFirst = first.fetchedAt;

  // Jump far past the 10-minute TTL and change the upstream payload.
  now += TTL_MS + 1000;
  pageSource = async () => [upstreamRun('r2')];

  const second = await getDataset();
  assert.equal(fetchCalls.length, 2, 'expected a second upstream fetch past the TTL');
  assert.equal(second.rows[0].runId, 'r2');
  assert.ok(second.fetchedAt > fetchedAtFirst, 'fetchedAt must advance on refresh');
});

test('within the TTL the cache is served without touching upstream', async () => {
  startTest({ initialPages: async () => [upstreamRun('r1')] });
  await getDataset();
  const second = await getDataset();
  assert.equal(fetchCalls.length, 1);
  assert.equal(second.rows[0].runId, 'r1');
});

test('concurrent callers share a single in-flight crawl', async () => {
  startTest({
    initialPages: async () => {
      // Let both callers stack up before the crawl resolves.
      await new Promise(r => setTimeout(r, 10));
      return [upstreamRun('r1')];
    }
  });
  const [a, b] = await Promise.all([getDataset(), getDataset()]);
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(a.rows.map(r => r.runId), b.rows.map(r => r.runId));
});

test('upstream failure serves stale data, then a later retry can refresh', async () => {
  startTest({ initialPages: async () => [upstreamRun('r1')] });
  await getDataset();

  now += TTL_MS + 1000;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const stale = await getDataset();
  assert.equal(stale.rows[0].runId, 'r1', 'stale rows served while upstream is down');

  pageSource = async () => [upstreamRun('r2')];
  stubFetch();
  const fresh = await getDataset();
  assert.equal(fresh.rows[0].runId, 'r2', 'retry after recovery refreshes the dataset');
});

test('a clean end of data reports crawlComplete: true', async () => {
  startTest({ initialPages: async () => [upstreamRun('r1')] });
  await getDataset();
  const info = getCacheInfo();
  assert.equal(info.crawlComplete, true);
  assert.equal(info.upstreamRows, 1);
});

test('hitting the crawl offset cap surfaces crawlComplete: false (#1090)', async () => {
  startTest({
    // Every page completely full → crawl only ends at the offset cap.
    initialPages: async (offset) => Array.from({ length: PAGE }, (_, i) => upstreamRun(`r${offset + i}`))
  });
  const ds = await getDataset();
  // offsets 0..20000 step 200 → 101 pages × 200 rows
  assert.equal(ds.rows.length, 101 * PAGE);
  assert.equal(getCacheInfo().crawlComplete, false);
  assert.equal(getCacheInfo().upstreamRows, 101 * PAGE);
  const raw = await getAllRunsRaw();
  assert.equal(raw.length, 101 * PAGE, 'raw index carries exactly the capped row set');
});
