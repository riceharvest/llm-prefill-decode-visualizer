// Regression tests for issue #1072: enum VALUES (?groupBy=, ?by=, ?sort_by=)
// were byte-exact while every string filter on the same endpoints is
// case-insensitive — uppercase spellings silently fell back to defaults.
// After the fix all three enum selectors match case-insensitively.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// --- shared upstream mock (same shape lib/best.test.js uses) ---------------
const ROWS = [
  {
    id: 'a1', batchSize: 1,
    tokSPrefill: 2000, tokSOut: 100,
    model: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B', params: 8 },
    hardwareGroupKey: 'riga', hardwareGroupLabel: 'Rig A',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'TestGPU A', gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
  },
  {
    id: 'b1', batchSize: 1,
    tokSPrefill: 4000, tokSOut: 85,
    model: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B', params: 8 },
    hardwareGroupKey: 'rigb', hardwareGroupLabel: 'Rig B',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'TestGPU B', gpuCount: 2, vramGb: 48 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
  }
];

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS }) });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const { default: bestHandler } = await import('./best.js');
const { default: benchmarksHandler } = await import('./benchmarks.js');
const { buildFreshnessBody } = await import('./agent_freshness.js');

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

async function call(handler, query = {}) {
  const res = mockRes();
  await handler({ method: 'GET', query }, res);
  assert.ok(res.body, 'handler should write a JSON body');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

// --- /api/best ?by= / ?sort_by= --------------------------------------------

test('#1072: /api/best?by=PREFILL ranks by prefill instead of silently decoding', async () => {
  const { status, json } = await call(bestHandler, { by: 'PREFILL' });
  assert.equal(status, 200);
  assert.equal(json.rankedBy, 'prefill');
  assert.equal(json.results[0].hardwareKey, 'rigb'); // 4000 > 2000 tok/s prefill
});

test('#1072: /api/best?by=Prefill (mixed case) also honors prefill', async () => {
  const { json } = await call(bestHandler, { by: 'Prefill' });
  assert.equal(json.rankedBy, 'prefill');
  assert.equal(json.results[0].hardwareKey, 'rigb');
});

test('#1072: /api/best?sort_by=WALLTIME alias honors case-insensitive value', async () => {
  const { json } = await call(bestHandler, { sort_by: 'WALLTIME' });
  assert.equal(json.rankedBy, 'walltime');
});

test('#1072: /api/best?by=COST upper-case reaches the cost ranking', async () => {
  const { json } = await call(bestHandler, { by: 'COST', hardwarePriceUsd: 1000 });
  assert.equal(json.rankedBy, 'cost');
});

test('#1072: unknown by= values still fall back to decode (unchanged)', async () => {
  const { json } = await call(bestHandler, { by: 'BOGUS' });
  assert.equal(json.rankedBy, 'decode');
});

test('#1072: lowercase spellings behave identically to before (back-compat)', async () => {
  const lower = await call(bestHandler, { by: 'prefill' });
  const upper = await call(bestHandler, { by: 'PREFILL' });
  assert.deepEqual(upper.json.results.map(r => r.hardwareKey), lower.json.results.map(r => r.hardwareKey));
});

// --- /api/benchmarks ?groupBy= ----------------------------------------------

test('#1072: /api/benchmarks?groupBy=quant groups by quantization, not default', async () => {
  const { status, json } = await call(benchmarksHandler, { groupBy: 'quant' });
  assert.equal(status, 200);
  assert.equal(json.engineCohortedByDefault, false);
});

test('#1072: /api/benchmarks?groupBy=QUANT no longer falls back to the default grouping', async () => {
  const { json } = await call(benchmarksHandler, { groupBy: 'QUANT' });
  assert.equal(json.engineCohortedByDefault, false);
  const quantGroups = await call(benchmarksHandler, { groupBy: 'quant' });
  assert.deepEqual(
    [...json.items].sort((a, b) => a.key.localeCompare(b.key)).map(g => g.key),
    [...quantGroups.json.items].sort((a, b) => a.key.localeCompare(b.key)).map(g => g.key)
  );
});

test('#1072: /api/benchmarks?groupBy=MODEL groups by model family like lowercase', async () => {
  const upper = await call(benchmarksHandler, { groupBy: 'MODEL' });
  const lower = await call(benchmarksHandler, { groupBy: 'model' });
  assert.equal(upper.status, 200);
  assert.deepEqual(upper.json.items.map(g => g.key), lower.json.items.map(g => g.key));
});

test('#1072: benchmarks default grouping unchanged when groupBy absent', async () => {
  const { json } = await call(benchmarksHandler, {});
  assert.equal(json.engineCohortedByDefault, true);
});

// --- /api/agent/freshness.json ?groupBy= ------------------------------------

const NOW = new Date('2026-08-23T12:00:00Z');

test('#1072: freshness groupBy=HARDWARE matches lowercase grouping + echo', () => {
  const mkRun = (overrides = {}) => ({
    runId: overrides.runId ?? 'r1',
    createdAt: '2026-08-20T12:00:00Z',
    modelFamily: overrides.modelFamily ?? 'llama-3-8b',
    modelId: 'meta-llama/Meta-Llama-3-8B',
    hardwareKey: overrides.hardwareKey ?? 'rtx-4090',
    hardware: 'RTX 4090',
    quantization: 'q4_k_m',
    engine: 'llama.cpp',
    engineVersion: null,
    prefillTokPerSec: 3000,
    decodeTokPerSec: 100
  });
  const runs = [
    mkRun({ hardwareKey: 'rtx-4090', modelFamily: 'llama-3-8b' }),
    mkRun({ hardwareKey: 'rtx-4090', modelFamily: 'qwen-3-8b', runId: 'r2' })
  ];
  const upper = buildFreshnessBody(runs, { groupBy: 'HARDWARE' }, { now: NOW }).body;
  const lower = buildFreshnessBody(runs, { groupBy: 'hardware' }, { now: NOW }).body;
  assert.equal(upper.filters.groupBy, 'hardware');
  assert.deepEqual(upper.groups.map(g => g.key), lower.groups.map(g => g.key));
  // Two model families on one rig → 1 hardware group but 2 model groups.
  assert.equal(upper.groups.length, 1);
});
