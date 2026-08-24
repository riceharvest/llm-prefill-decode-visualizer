// #525 — /api/sizing must surface input substitution in a machine-readable
// warnings[] array instead of silently rewriting unusable inputs.
// #523 — meetsSlo must expose which criteria were actually evaluated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const handler = (await import(path.join(here, '..', '[...path].js'))).default;
const lm = await import(path.join(here, '..', '_localmaxxing.js'));

function upRow(id, over = {}) {
  return {
    id,
    createdAt: '2026-08-01T12:00:00.000Z',
    model: { hfId: 'unsloth/Qwen3.6-27B-MTP-GGUF', displayName: 'Qwen3.6 27B', params: 27 },
    hardwareGroupKey: `rig${id % 3}`,
    hardwareGroupLabel: `Rig ${id % 3}`,
    hardware: { hwClass: 'discrete_gpu', gpuName: `GPU ${id % 3}`, gpuCount: 1, vramGb: 24 + (id % 3) * 8 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q8_0' },
    tokSPrefill: 3800,
    tokSOut: 100,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    batchSize: 1,
    ...over
  };
}

const ROWS = Array.from({ length: 6 }, (_, i) => upRow(200 + i));

const _realFetch = globalThis.fetch; // restored by the test runner process exit
globalThis.fetch = async (url) => {
  const u = String(url);
  assert.ok(u.includes('localmaxxing.com'), `unexpected fetch target: ${u}`);
  const offset = Number(new URL(u).searchParams.get('offset') || 0);
  return { ok: true, status: 200, json: async () => ({ rows: ROWS.slice(offset, offset + 200) }) };
};

function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    hasHeader() { return false; },
    removeHeader(k) { delete headers[String(k).toLowerCase()]; },
    end(body) { this.body = body; }
  };
}

async function call(url) {
  const res = mockRes();
  const u = new URL(url, 'https://unit.test');
  await handler({ method: 'GET', url: u.pathname + u.search, query: Object.fromEntries(u.searchParams.entries()), headers: {} }, res);
  assert.equal(res.statusCode, 200, `${url} -> ${res.statusCode}: ${res.body}`);
  return JSON.parse(res.body);
}

test('#525: substituted inputs are reported in warnings[] with requested vs used', async () => {
  lm.invalidateCache();
  const body = await call('/api/sizing?model=qwen&contextLength=-5&concurrency=0');
  assert.ok(Array.isArray(body.warnings), 'response must carry a warnings array');
  const fields = Object.fromEntries(body.warnings.map(w => [w.field, w]));
  assert.equal(fields.contextLength.code, 'input_substituted');
  assert.equal(String(fields.contextLength.requested), '-5');
  assert.equal(fields.contextLength.used, body.workload.contextLength);
  assert.equal(fields.concurrency.used, body.workload.concurrency);
  assert.ok(body.warnings.every(w => w.message && w.code === 'input_substituted'));
});

test('#525: clean inputs yield an empty warnings array (field always present)', async () => {
  lm.invalidateCache();
  const body = await call('/api/sizing?model=qwen&contextLength=32768&concurrency=4');
  assert.deepEqual(body.warnings, []);
});

test('#523: unevaluated criteria are listed and allEvaluated flags partial verdicts', async () => {
  lm.invalidateCache();
  // No SLO budgets → ttft/tpot never evaluated; vram fit computable (params known).
  const body = await call('/api/sizing?model=qwen');
  const row = body.recommendations[0];
  assert.ok(row.meetsSlo.evaluated.includes('vram') || row.meetsSlo.unevaluated.includes('vram'));
  assert.ok(row.meetsSlo.unevaluated.includes('ttft'));
  assert.ok(row.meetsSlo.unevaluated.includes('tpot'));
  assert.equal(row.meetsSlo.allEvaluated, false);
  assert.deepEqual(row.meetsSlo.evaluated.filter(k => !row.meetsSlo.unevaluated.includes(k)), row.meetsSlo.evaluated);
});

test('#523: supplying an SLO budget moves that criterion into evaluated', async () => {
  lm.invalidateCache();
  const body = await call('/api/sizing?model=qwen&maxTpotMs=100000');
  const row = body.recommendations[0];
  assert.ok(row.meetsSlo.evaluated.includes('tpot'), 'tpot evaluated once a budget is given');
  assert.ok(!row.meetsSlo.unevaluated.includes('tpot'));
  assert.equal(typeof row.meetsSlo.tpot, 'boolean');
});
