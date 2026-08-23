import { test } from 'node:test';
import assert from 'node:assert/strict';
import agentBenchmarksHandler, { toAgentRun } from '../api/_handlers/agent_benchmarks.js';
import { invalidateCache } from '../api/_localmaxxing.js';

function row(overrides = {}) {
  const id = overrides.id ?? 'r1';
  return {
    id,
    tokSPrefill: 1200,
    tokSOut: 100,
    createdAt: '2026-08-01T00:00:00Z',
    contextLength: 8192,
    hardwareGroupKey: 'rtx-4090',
    hardwareGroupLabel: 'RTX 4090',
    model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6000', quantization: 'q4_k_m' },
    batchSize: 1,
    ...overrides
  };
}

async function callHandler(query) {
  const captured = {};
  const res = {
    statusCode: 0,
    setHeader() {},
    getHeader() { return undefined; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(body);
    }
  };
  await agentBenchmarksHandler({ query }, res);
  return captured;
}

test('/api/agent/benchmarks.json returns valid JSON with schema_version and expected fields', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [row()] }) // single short page ends pagination
  });
  invalidateCache();

  const { status, body } = await callHandler({});
  assert.equal(status, 200);

  // Valid JSON of the expected agent-friendly envelope.
  assert.equal(typeof body, 'object');
  assert.equal(body.schema_version, '1');
  for (const field of [
    'description', 'endpoint', 'snapshot', 'generatedAt', 'filters',
    'total', 'count', 'runs', 'has_more', 'next_cursor', 'caveats', 'relatedEndpoints'
  ]) {
    assert.ok(field in body, `missing field: ${field}`);
  }
  assert.equal(body.endpoint, '/api/agent/benchmarks.json');
  assert.deepEqual(body.filters, {
    hardware: null, model: null, quant: null, contextBand: null, maxAgeDays: null
  });
  assert.equal(body.total, body.runs.length);

  // Every run carries the flat agent-friendly field set.
  assert.ok(body.runs.length > 0);
  for (const run of body.runs) {
    for (const field of [
      'runId', 'model', 'modelFamily', 'hardware', 'hardwareKey', 'quantization',
      'engine', 'prefillTokPerSec', 'decodeTokPerSec', 'measuredAt', 'ageDays', 'staleness'
    ]) {
      assert.ok(field in run, `run missing field: ${field}`);
    }
    assert.equal(typeof run.decodeTokPerSec, 'number');
    assert.equal(run.modelFamily, 'test-8b'); // normalized family
  }
});

test('wraps the same runs search_runs exposes, fastest decode first', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [
      row({ id: 'slow', tokSOut: 40 }),
      row({ id: 'fast', tokSOut: 90, tokSPrefill: 2000 }),
      row({ id: 'mid', tokSOut: 65 })
    ] })
  });
  invalidateCache();

  const { status, body } = await callHandler({});
  assert.equal(status, 200);
  assert.equal(body.total, 3);
  assert.deepEqual(body.runs.map(r => r.runId), ['fast', 'mid', 'slow']);

  const fast = body.runs[0];
  assert.equal(fast.hardwareKey, 'rtx-4090');
  assert.equal(fast.hardware, 'RTX 4090');
  assert.equal(fast.quantization, 'q4_k_m');
  assert.equal(fast.engine, 'llama.cpp');
  assert.equal(fast.prefillTokPerSec, 2000);
  assert.equal(fast.decodeTokPerSec, 90);
  assert.equal(fast.measuredAt, '2026-08-01T00:00:00Z');
  assert.equal(fast.staleness, 'fresh');
  assert.ok(fast.source.includes('/runs/fast'));
});

test('applies search_runs-style filters (hardware substring, quant exact)', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [
      row({ id: 'a', tokSOut: 90 }),
      row({ id: 'b', tokSOut: 80, hardwareGroupKey: 'm4-max', hardwareGroupLabel: 'M4 Max' }),
      row({ id: 'c', tokSOut: 70, hardwareGroupKey: 'ryzen-7950x', hardwareGroupLabel: 'Ryzen 7950X',
        engine: { engineName: 'llama.cpp', quantization: 'q8_0' } })
    ] })
  });
  invalidateCache();

  const byHardware = await callHandler({ hardware: '4090' });
  assert.equal(byHardware.body.total, 1);
  assert.equal(byHardware.body.runs[0].runId, 'a');
  assert.equal(byHardware.body.filters.hardware, '4090');

  const byQuant = await callHandler({ quant: 'q4_k_m' });
  assert.equal(byQuant.body.total, 2);
  assert.ok(byQuant.body.runs.every(r => r.quantization === 'q4_k_m'));

  const noMatch = await callHandler({ model: 'nonexistent-model' });
  assert.equal(noMatch.body.total, 0);
  assert.deepEqual(noMatch.body.runs, []);
});

test('respects limit pagination and reports has_more/next_cursor', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: Array.from({ length: 5 }, (_, i) => row({ id: `r${i}`, tokSOut: 100 - i })) })
  });
  invalidateCache();

  const page1 = await callHandler({ limit: '2' });
  assert.equal(page1.body.count, 2);
  assert.equal(page1.body.total, 5);
  assert.equal(page1.body.has_more, true);
  assert.ok(page1.body.next_cursor);

  const page2 = await callHandler({ limit: '2', cursor: page1.body.next_cursor });
  assert.equal(page2.body.count, 2);
  assert.notDeepEqual(page2.body.runs.map(r => r.runId), page1.body.runs.map(r => r.runId));
});

test('toAgentRun maps a raw run onto the flat agent shape', () => {
  const agentRun = toAgentRun({
    runId: 'x1',
    modelName: 'Test 8B',
    modelId: 'org/Test-8B',
    modelFamily: 'test-8b',
    paramsB: 8,
    hardware: 'RTX 4090',
    hardwareKey: 'rtx-4090',
    hwClass: 'discrete_gpu',
    quantization: 'q4_k_m',
    engine: 'llama.cpp',
    engineVersion: 'b6000',
    prefillTokPerSec: 1200,
    decodeTokPerSec: 100,
    contextLength: 8192,
    contextBand: '1k-8k',
    createdAt: '2026-08-01T00:00:00Z',
    ageDays: 22,
    staleness: 'fresh',
    source: 'https://localmaxxing.com/en/runs/x1'
  });
  assert.deepEqual(agentRun, {
    runId: 'x1',
    model: 'Test 8B',
    modelId: 'org/Test-8B',
    modelFamily: 'test-8b',
    paramsB: 8,
    hardware: 'RTX 4090',
    hardwareKey: 'rtx-4090',
    hwClass: 'discrete_gpu',
    quantization: 'q4_k_m',
    engine: 'llama.cpp',
    engineVersion: 'b6000',
    prefillTokPerSec: 1200,
    decodeTokPerSec: 100,
    contextLength: 8192,
    contextBand: '1k-8k',
    measuredAt: '2026-08-01T00:00:00Z',
    ageDays: 22,
    staleness: 'fresh',
    source: 'https://localmaxxing.com/en/runs/x1'
  });
});
