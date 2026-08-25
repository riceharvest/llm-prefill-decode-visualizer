// Routing test: the catch-all serverless function must dispatch
// /api/agent/benchmarks.json (and its /v1/ alias) to the agent benchmarks
// handler.
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
    hasHeader(k) { return k in this.headers; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(body);
    }
  };
  await handler({ url, query }, res);
  return captured;
}

test('catch-all router dispatches /api/agent/benchmarks.json to the agent handler', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [{
      id: 'r1', tokSPrefill: 1200, tokSOut: 100,
      hardwareGroupKey: 'rtx-4090', hardwareGroupLabel: 'RTX 4090',
      model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
      engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' },
      batchSize: 1
    }] })
  });
  invalidateCache();

  for (const url of ['/api/agent/benchmarks.json', '/api/v1/agent/benchmarks.json']) {
    const { status, body } = await callHandler(url);
    assert.equal(status, 200, url);
    assert.equal(body.endpoint, '/api/agent/benchmarks.json');
    assert.equal(body.total, 1);
    assert.equal(body.runs[0].hardwareKey, 'rtx-4090');
  }
});
