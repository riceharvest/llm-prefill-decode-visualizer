// /api/best calc-id filter sensitivity (#513).
//
// The response `id` is documented as a content hash of the resolved request,
// replayable via /api/calc/<id>?endpoint=best&<same filters>. Four filters
// that demonstrably change the result set — engine, max_age, minDecode,
// maxVramGb — were left out of the hash, so distinct queries collided on one
// id and citations/replays were ambiguous. Each of them must move the id;
// unrelated junk params must not.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

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

const { default: handler } = await import('./best.js');

async function idFor(query) {
  const req = { method: 'GET', query };
  const res = {
    statusCode: 200, headers: {}, bodyText: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(this.headers, String(k).toLowerCase()); },
    status(c) { this.statusCode = c; return this; },
    end(p) { if (p !== undefined) this.bodyText = p; }
  };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(res.bodyText).id;
}

test('each result-changing cohort filter moves the calc id (#513)', async () => {
  const base = await idFor({ by: 'decode', limit: '5' });

  for (const [name, extra] of [
    ['engine', { engine: 'vllm' }],
    ['max_age', { max_age: '30' }],
    ['minDecode', { minDecode: '100' }],
    ['maxVramGb', { maxVramGb: '24' }]
  ]) {
    const filtered = await idFor({ by: 'decode', limit: '5', ...extra });
    assert.notEqual(filtered, base, `id must change when ?${name}= changes the result set`);
  }
});

test('the same filtered query still mints the same id (determinism kept)', async () => {
  const q = { by: 'decode', limit: '5', engine: 'llama', maxVramGb: '24', minDecode: '90' };
  assert.equal(await idFor(q), await idFor(q));
});

test('unrelated junk params still do NOT affect the id', async () => {
  const a = await idFor({ by: 'decode' });
  const b = await idFor({ by: 'decode', bogusParam: 'zzz' });
  assert.equal(a, b);
});
