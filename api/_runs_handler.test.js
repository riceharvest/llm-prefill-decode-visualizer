import { test } from 'node:test';
import { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let realFetch;

function upstreamRow(id, { batchSize = 1, concurrency = null, prefill = 1200, decode = 45 } = {}) {
  return {
    id,
    createdAt: '2026-08-01T00:00:00Z',
    batchSize,
    engineFlags: { concurrency },
    tokSPrefill: prefill,
    tokSOut: decode,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    model: { hfId: 'unsloth/Qwen3.6-27B-MTP-GGUF', displayName: 'Qwen3.6 27B', params: 27 },
    hardwareGroupKey: 'rtx-5060-ti-16gb',
    hardwareGroupLabel: 'RTX 5060 Ti 16GB',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 5060 Ti', gpuCount: 1 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6282', quantization: 'q4_k_m' }
  };
}

beforeEach(() => {
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function freshHandler(rows) {
  // Dynamic import + cache invalidation so each test drives its own dataset.
  invalidate();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows }) });
  return (await import('./_handlers/runs.js')).default;
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    chunks: [],
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    write(chunk) { this.chunks.push(String(chunk)); },
    end(payload) {
      if (payload !== undefined) this.chunks.push(String(payload));
      this.body = this.chunks.join('');
    }
  };
  return res;
}

const { invalidateCache } = await import('./_localmaxxing.js');
function invalidate() { invalidateCache(); }

test('GET /api/runs dumps the full index including non-comparable runs', async () => {
  const handler = await freshHandler([
    upstreamRow(1),
    upstreamRow(2, { batchSize: 8, decode: 310 })
  ]);
  const res = mockRes();
  await handler({ method: 'GET', query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /application\/json/);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.ok(res.headers['X-Schema-Version']);
  const body = JSON.parse(res.body);
  assert.equal(body.schema_version, '1');
  assert.equal(body.rowCount, 2);
  assert.equal(body.comparableCount, 1);
  assert.deepEqual(body.runs.map(r => r.runId), [1, 2]);
  const batched = body.runs.find(r => r.runId === 2);
  assert.equal(batched.comparable, false);
  assert.ok(Array.isArray(body.dataDictionary));
  assert.ok(body.dataDictionary.some(d => d.column === 'comparable'));
});

test('GET /api/runs?comparable=true restricts to single-stream runs', async () => {
  const handler = await freshHandler([
    upstreamRow(1),
    upstreamRow(2, { batchSize: 8, decode: 310 })
  ]);
  const res = mockRes();
  await handler({ method: 'GET', query: { comparable: 'true' } }, res);
  const body = JSON.parse(res.body);
  assert.equal(body.comparableOnly, true);
  assert.deepEqual(body.runs.map(r => r.runId), [1]);
  assert.ok(body.runs.every(r => r.comparable === true));
});

test('GET /api/runs?format=csv returns RFC 4180 CSV with a # preamble', async () => {
  const handler = await freshHandler([
    upstreamRow(1),
    upstreamRow(2, { batchSize: 8, decode: 310 })
  ]);
  const res = mockRes();
  await handler({ method: 'GET', query: { format: 'csv' } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.headers['Content-Disposition'], /attachment/);
  const lines = res.body.split('\r\n');
  assert.ok(lines[0].startsWith('# dataset:'));
  const headerIdx = lines.findIndex(l => l.startsWith('runId,'));
  assert.ok(headerIdx > 0, 'CSV header row must follow the preamble');
  const dataRows = lines.filter(l => l && !l.startsWith('#')).slice(1);
  assert.equal(dataRows.length, 2);
});

test('upstream failure surfaces a problem+json UPSTREAM_UNAVAILABLE error', async () => {
  const handler = await freshHandler([]);
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const res = mockRes();
  await handler({ method: 'GET', query: {}, headers: {}, url: '/api/runs' }, res);
  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'UPSTREAM_UNAVAILABLE');
});
