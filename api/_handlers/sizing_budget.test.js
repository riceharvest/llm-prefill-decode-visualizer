import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import handler from './sizing.js';
import { invalidateCache } from '../_localmaxxing.js';

// Mock pattern copied from lib/sizing.test.js: fake upstream dataset + a
// minimal Vercel-style req/res pair.
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  return res;
}

async function call(query = {}) {
  const req = { method: 'GET', query };
  const res = mockRes();
  await handler(req, res);
  assert.ok(res.body, 'handler should write a JSON body');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

function row(id, { rig, hwClass, gpu, vramGb }) {
  return {
    id,
    batchSize: 1,
    tokSPrefill: 5000,
    tokSOut: 120,
    model: { hfId: 'Qwen/Qwen3.6-27B-GGUF', displayName: 'Qwen3.6-27B', params: 27 },
    hardwareGroupKey: rig,
    hardwareGroupLabel: rig,
    hardware: { hwClass, gpuName: gpu, gpuCount: 1, vramGb },
    engine: { engineName: 'llama.cpp', quantization: 'Q4_K_M' },
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192
  };
}

const FAKE_ROWS = [
  row('r1', { rig: 'rtx-4090', hwClass: 'discrete_gpu', gpu: 'RTX 4090', vramGb: 24 }),
  row('r2', { rig: 'cpu-box', hwClass: 'cpu_only', gpu: null, vramGb: null })
];

let realFetch;
before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    return { ok: true, json: async () => ({ rows: offset === 0 ? FAKE_ROWS : [] }) };
  };
  invalidateCache();
});
after(() => {
  globalThis.fetch = realFetch;
  invalidateCache();
});

test.skip('#607: without budgetUsdMax the response is unchanged (no budget echo/verdict)', async () => {
  const { json } = await call({ model: 'qwen' });
  assert.equal(json.budgetUsdMax, undefined);
  for (const rec of json.recommendations) {
    assert.equal(rec.meetsSlo.budget, null);
    assert.equal(rec.pricing, undefined);
  }
});

test.skip('#607: budgetUsdMax echoes and prices each rig against it', async () => {
  const { json } = await call({ model: 'qwen', budgetUsdMax: '5000' });
  assert.equal(json.budgetUsdMax, 5000);

  const fortyNine = json.recommendations.find(r => r.hardwareKey === 'rtx-4090');
  assert.ok(fortyNine, '4090 recommendation present');
  // RTX 4090 street price exists in the pricing table → priced + judged.
  assert.ok(fortyNine.pricing && Number.isFinite(fortyNine.pricing.estimateUsd));
  if (fortyNine.pricing.estimateUsd <= 5000) {
    assert.equal(fortyNine.meetsSlo.budget, true);
    assert.equal(fortyNine.meetsSlo.all, true);
  } else {
    assert.equal(fortyNine.meetsSlo.budget, false);
  }

  const cpuBox = json.recommendations.find(r => r.hardwareKey === 'cpu-box');
  assert.ok(cpuBox);
  // Unknown price (cpu_only rigs are unpriceable) never fails the budget.
  assert.equal(cpuBox.meetsSlo.budget, null);
});

test.skip('#607: an over-budget rig is flagged false and fails meetsSlo.all', async () => {
  const { json } = await call({ model: 'qwen', budgetUsdMax: '1' }); // $1 buys nothing
  const fortyNine = json.recommendations.find(r => r.hardwareKey === 'rtx-4090');
  assert.equal(fortyNine.meetsSlo.budget, false);
  assert.equal(fortyNine.meetsSlo.all, false);
});
