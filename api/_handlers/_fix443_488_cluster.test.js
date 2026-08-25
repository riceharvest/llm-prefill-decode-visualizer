// Offline handler-level tests for the #443 param-validation warnings and the
// #488 envelope discriminator on /api/localmaxxing + /api/benchmarks.
// The dataset fetch (api/_localmaxxing.js getDataset) is stubbed via
// globalThis.fetch so no network is needed.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const ROWS = [
  { id: 'r1', createdAt: '2026-08-01T00:00:00.000Z', batchSize: 1, tokSPrefill: 3800, tokSOut: 105,
    model: { hfId: 'org/ModelA-8B', displayName: 'ModelA 8B', params: 8 },
    hardwareGroupKey: 'rtx4090', hardwareGroupLabel: 'RTX 4090',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' }, promptTokens: 2048 },
  { id: 'r2', createdAt: '2026-08-02T00:00:00.000Z', batchSize: 1, tokSPrefill: 2400, tokSOut: 65,
    model: { hfId: 'org/ModelA-8B', displayName: 'ModelA 8B', params: 8 },
    hardwareGroupKey: 'rtx3090', hardwareGroupLabel: 'RTX 3090',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 3090', gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' }, promptTokens: 2048 },
  { id: 'r3', createdAt: '2026-08-03T00:00:00.000Z', batchSize: 1, tokSPrefill: 4600, tokSOut: 78,
    model: { hfId: 'org/ModelB-70B', displayName: 'ModelB 70B', params: 70 },
    hardwareGroupKey: 'dual3090', hardwareGroupLabel: 'Dual RTX 3090',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 3090', gpuCount: 2, vramGb: 48 },
    engine: { engineName: 'exllamav2', engineVersion: '0.2.7', quantization: 'exl2' }, promptTokens: 2048 }
];

before(async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ rows: [...ROWS] })
  });
});

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers?.[k]; },
    hasHeader(k) { return Object.hasOwn(this.headers || {}, k); },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  return res;
}

async function call(handler, query) {
  const req = { method: 'GET', query, headers: {} };
  const res = mockRes();
  await handler(req, res);
  assert.ok(res.body, 'handler should write a body');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

const localmaxxing = (await import('./localmaxxing.js')).default;
const benchmarks = (await import('./benchmarks.js')).default;

// ---- #488 envelope discriminator ------------------------------------------

test('localmaxxing bare call → mode "index" with hardwareGroups (#488)', async () => {
  const { status, json } = await call(localmaxxing, {});
  assert.equal(status, 200);
  assert.equal(json.mode, 'index');
  assert.ok(Array.isArray(json.hardwareGroups));
  assert.ok(json.totalComparableRuns >= 3);
});

test('localmaxxing filtered call → mode "runs" with items (#488)', async () => {
  const { json } = await call(localmaxxing, { hardware: 'rtx' });
  assert.equal(json.mode, 'runs');
  assert.ok(Array.isArray(json.items));
});

// ---- #443 silent param-ignore signals -------------------------------------

test('localmaxxing index mode: ?limit= is inert and now flagged (#443)', async () => {
  const { json } = await call(localmaxxing, { limit: '-5' });
  assert.equal(json.mode, 'index');
  const w = json.warnings.find(x => x.code === 'param_ignored_in_index_mode');
  assert.ok(w, `expected index-mode warning in ${JSON.stringify(json.warnings)}`);
  assert.match(w.message, /hardware-group summary/);
});

test('localmaxxing: garbage max_age is flagged instead of silently dropped (#443)', async () => {
  const { json } = await call(localmaxxing, { hardware: 'rtx', max_age: 'abc' });
  assert.equal(json.maxAgeDays, null);
  const w = json.warnings.find(x => x.code === 'param_value_ignored' && x.param === 'max_age');
  assert.ok(w);
  assert.equal(w.requested, 'abc');
});

test('benchmarks: unknown groupBy is flagged while defaulting to hardwareModel (#443)', async () => {
  const { status, json } = await call(benchmarks, { groupBy: 'notAField' });
  assert.equal(status, 200);
  const w = json.warnings.find(x => x.code === 'param_value_ignored' && x.param === 'groupBy');
  assert.ok(w, `expected groupBy warning in ${JSON.stringify(json.warnings)}`);
  assert.equal(w.used, 'hardwareModel');
});

test('benchmarks: valid groupBy emits no param warning (#443)', async () => {
  const { json } = await call(benchmarks, { groupBy: 'model' });
  assert.ok(!json.warnings.some(x => x.code === 'param_value_ignored'));
});

test('benchmarks: garbage max_age + invalid limit are both flagged (#443)', async () => {
  const { json } = await call(benchmarks, { max_age: 'abc', limit: '-5' });
  const codes = json.warnings.filter(x => x.code === 'param_value_ignored').map(x => x.param).sort();
  assert.deepEqual(codes, ['limit', 'max_age']);
});
