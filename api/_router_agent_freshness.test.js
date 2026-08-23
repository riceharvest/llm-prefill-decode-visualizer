// Routing test: the catch-all serverless function must dispatch
// /api/agent/freshness.json (and its /v1/ alias + /confidence.json alias)
// to the agent freshness handler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/[...path].js';
import { invalidateCache } from '../api/_localmaxxing.js';

async function callHandler(url, query = {}) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(body);
    }
  };
  await handler({ url, query }, res);
  return captured;
}

const MOCK_ROWS = [{
  id: 'r1', tokSPrefill: 1500, tokSOut: 80, batchSize: 1,
  createdAt: '2026-08-20T00:00:00Z',
  hardwareGroupKey: 'rtx-4090', hardwareGroupLabel: 'RTX 4090',
  model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
  engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
}];

function mockFetch() {
  return async () => ({ ok: true, json: async () => ({ rows: structuredClone(MOCK_ROWS) }) });
}

test('catch-all router dispatches the freshness/confidence endpoints', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });
  globalThis.fetch = mockFetch();
  invalidateCache();

  for (const [url, endpoint] of [
    ['/api/agent/freshness.json', '/api/agent/freshness.json'],
    ['/api/v1/agent/freshness.json', '/api/agent/freshness.json'], // versioned rewrite
    ['/api/agent/confidence.json', '/api/agent/confidence.json']   // alias, same handler
  ]) {
    const { status, body } = await callHandler(url);
    assert.equal(status, 200, url);
    assert.equal(body.endpoint, endpoint, url);
    assert.ok(body.dataset.totalRuns >= 1, `${url}: expected runs in dataset`);
    assert.ok(Array.isArray(body.groups) && body.groups.length >= 1, `${url}: expected groups`);
    assert.equal(typeof body.summary.confidence.meanScore, 'number', url);
  }
});
