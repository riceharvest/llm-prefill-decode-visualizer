// /api/diff contract tests: in-band unit declarations (#479) and the
// schema_version / X-Schema-Version promise on success AND error paths (#481).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/_handlers/diff.js';
import { computeRunDiff } from '../api/_diff.js';
import { invalidateCache } from '../api/_localmaxxing.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

async function call(query) {
  const res = mockRes();
  await handler({ method: 'GET', query }, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* error bodies may be text */ }
  return { status: res.statusCode, headers: res.headers, json };
}

function upstreamRow(id, overrides = {}) {
  return {
    id,
    batchSize: 1,
    engineFlags: {},
    tokSPrefill: 4000,
    tokSOut: 100,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    hardwareGroupKey: `rig-${id}`,
    hardwareGroupLabel: `Rig ${id}`,
    hardware: { hwClass: 'discrete_gpu', gpuName: 'GPU', gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' },
    model: { hfId: 'llama-3-8b', displayName: 'Llama 3 8B', params: 8 },
    ...overrides
  };
}

beforeEach(() => {
  invalidateCache();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [upstreamRow(101), upstreamRow(102, { tokSOut: 200, tokSPrefill: 6000 })] })
  });
});

// ---------- #479: units ----------

test('every diff metric declares its unit; times are seconds (#479)', () => {
  const { metrics } = computeRunDiff(
    { prefillTokPerSec: 4000, decodeTokPerSec: 100 },
    { prefillTokPerSec: 2000, decodeTokPerSec: 50 }
  );
  assert.equal(metrics.prefill.unit, 'tokPerSec');
  assert.equal(metrics.decode.unit, 'tokPerSec');
  for (const key of ['ttft', 'tpot', 'walltime']) {
    assert.equal(metrics[key].unit, 'seconds');
  }
});

test('deltaPct scale is declared as a fraction at the diff root (#479)', () => {
  const d = computeRunDiff(
    { prefillTokPerSec: 4000, decodeTokPerSec: 100 },
    { prefillTokPerSec: 6000, decodeTokPerSec: 150 }
  );
  assert.equal(d.deltaPctScale, 'fraction');
  // And it really is a fraction: B is 1.5× A → deltaPct 0.5
  assert.equal(d.metrics.decode.deltaPct, 0.5);
});

// ---------- #481: schema_version contract ----------

test('successful diff responses carry schema_version + X-Schema-Version (#481)', async () => {
  const r = await call({ runA: '101', runB: '102' });
  assert.equal(r.status, 200);
  assert.equal(r.json.schema_version, '1');
  assert.equal(r.headers['X-Schema-Version'], '1');
});

test('error responses carry schema_version + header too (#481)', async () => {
  const missing = await call({});
  assert.equal(missing.status, 400);
  assert.equal(missing.json.schema_version, '1');
  assert.equal(missing.headers['X-Schema-Version'], '1');

  const notFound = await call({ runA: '999', runB: '101' });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.json.schema_version, '1');
  assert.equal(notFound.headers['X-Schema-Version'], '1');
});

test('units note is present in the response description and body', async () => {
  const r = await call({ runA: '101', runB: '102' });
  assert.match(r.json.description, /SECONDS/);
  assert.equal(r.json.diff.deltaPctScale, 'fraction');
});
