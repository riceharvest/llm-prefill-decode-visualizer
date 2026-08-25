// #719 — GET /api/localmaxxing?runId=<id> single-run lookup. Previously the
// param did not exist and was silently ignored (fell back to the summary
// envelope), so the wizard's applied lmx:<id> preset was unreplayable.
// Also pins the additive comparability inputs on run records (#719 point 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import handler from './_handlers/localmaxxing.js';
import { invalidateCache } from './_localmaxxing.js';

function makeRes() {
  const captured = {};
  return {
    captured,
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    end(body) {
      captured.status = this.statusCode;
      captured.rawBody = body ?? '';
    }
  };
}

const MOCK_ROWS = [{
  id: 'lmx-run-1', tokSPrefill: 1500, tokSOut: 80, batchSize: 1,
  createdAt: '2026-08-20T00:00:00Z',
  hardwareGroupKey: 'rtx-4090', hardwareGroupLabel: 'RTX 4090',
  hwClass: 'discrete_gpu',
  model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
  engine: { engineName: 'llama.cpp', quantization: 'q4_k_m', engineVersion: 'b123' },
  engineFlags: { concurrency: 1, numParallel: 1 },
  promptTokens: 2048, outputTokens: 512, contextLength: 8192
}];

async function get(query) {
  const res = makeRes();
  await handler({ method: 'GET', query, headers: { 'x-forwarded-for': 'runid-test' } }, res);
  return { status: res.captured.status, body: JSON.parse(res.captured.rawBody || '{}'), headers: res.headers };
}

async function mockDataset(t) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: structuredClone(MOCK_ROWS) }) });
  invalidateCache();
  t.after(() => { globalThis.fetch = originalFetch; invalidateCache(); });
}

test('unknown ?runId= returns a 404 problem instead of the silent summary fallback (#719)', async t => {
  await mockDataset(t);

  const { status, body } = await get({ runId: 'nope-does-not-exist' });
  assert.equal(status, 404);
  assert.equal(body.status, 404);
  assert.match(String(body.detail || body.title || ''), /runId/);
});

test('?runId=<id> returns exactly the record behind the lmx:<id> wizard preset (#719)', async t => {
  await mockDataset(t);

  const { status, body } = await get({ runId: 'lmx-run-1' });
  assert.equal(status, 200);
  assert.equal(body.presetId, 'lmx:lmx-run-1');
  assert.equal(body.run.runId, 'lmx-run-1');
  assert.equal(body.run.decodeTokPerSec, 80);
  assert.ok('batchSize' in body.run, 'comparability inputs must be present');
  // Comparability inputs let agents re-derive isComparableRun.
  assert.equal(body.run.batchSize, 1);
  assert.equal(body.run.concurrency, 1);
  assert.equal(body.run.numParallel, 1);
});
