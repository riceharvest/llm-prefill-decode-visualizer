// Cache-refresh + walk-dedup tests for api/_localmaxxing.js
// Covers:
// - #1076/#1101: cache.promise must be cleared on success so the 10-minute TTL
//   can actually trigger a fresh upstream walk (previously dead code).
// - #1102: an upstream insert mid-walk shifts page offsets and used to
//   duplicate a run inside the cached dataset.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDataset, getAllRunsRaw, invalidateCache } from './_localmaxxing.js';

const PAGE = 200; // keep in sync with _localmaxxing.js PAGE

/** Upstream-shaped run record (only fields slim()/comparable() read). */
function upRun(id) {
  return {
    id,
    createdAt: '2026-08-24T00:00:00Z',
    model: { hfId: 'org/model', displayName: 'Model', params: 8 },
    hardwareGroupKey: 'rtx-4090',
    hardwareGroupLabel: 'RTX 4090',
    hardware: { hwClass: 'gpu', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m', engineVersion: 'b1' },
    batchSize: 1,
    tokSPrefill: 4000,
    tokSOut: 100,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192
  };
}

/** Install a fake upstream fetch serving `pages` keyed by offset. Returns the mock. */
function stubUpstream(t, pages) {
  return t.mock.method(globalThis, 'fetch', async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    const rows = pages[offset];
    if (!rows) throw new Error(`unexpected upstream offset ${offset}`);
    return { ok: true, status: 200, json: async () => ({ rows }) };
  });
}

test('getDataset refreshes after the cache TTL expires (#1076 #1101)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const pages = { 0: [upRun('a')] }; // single short page ends the walk
  const fetchMock = stubUpstream(t, pages);
  invalidateCache();

  const first = await getDataset();
  assert.deepEqual(first.rows.map(r => r.runId), ['a']);
  assert.equal(fetchMock.mock.callCount(), 1, 'first load performs one upstream page fetch');

  // An immediate second call is served from the fresh cache.
  await getDataset();
  assert.equal(fetchMock.mock.callCount(), 1);

  // Past the TTL a NEW walk must start (this was dead before the fix).
  t.mock.timers.tick(11 * 60 * 1000);
  pages[0] = [upRun('a'), upRun('b')];
  const second = await getDataset();
  assert.equal(fetchMock.mock.callCount(), 2, 'TTL expiry triggers a fresh upstream walk');
  assert.deepEqual(second.rows.map(r => r.runId), ['a', 'b']);
});

test('concurrent callers share one in-flight walk instead of stampeding (#1076)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const fetchMock = stubUpstream(t, { 0: [upRun('x')] });
  invalidateCache();

  const [a, b] = await Promise.all([getDataset(), getDataset()]);
  assert.equal(a.rows.length, 1);
  assert.deepEqual(b.rows.map(r => r.runId), a.rows.map(r => r.runId));
  assert.equal(fetchMock.mock.callCount(), 1, 'one walk total for two concurrent callers');

  // After everything settles the walk slot is free again (retryability).
  t.mock.timers.tick(11 * 60 * 1000);
  await getDataset();
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('an upstream insert mid-walk cannot duplicate runs in the dataset (#1102)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  // Page 1 holds ids r000..r199; an insert lands between the page fetches, so
  // page 2 re-serves r199 followed by r200..r397.
  const page1 = Array.from({ length: PAGE }, (_, i) => upRun(`r${String(i).padStart(3, '0')}`));
  const page2 = [
    ...Array.from({ length: 199 }, (_, i) => upRun(`r${String(i + 199).padStart(3, '0')}`))
  ];
  stubUpstream(t, { 0: page1, [PAGE]: page2 });
  invalidateCache();

  await getDataset();
  const raw = await getAllRunsRaw();
  const ids = raw.map(r => String(r.runId));
  assert.equal(ids.length, new Set(ids).size, 'no duplicate runIds across the paged walk');
  assert.equal(raw.length, PAGE + 198, `expected ${PAGE + 198} unique rows, got ${raw.length}`);
});
