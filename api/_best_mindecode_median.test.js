// #599 — ?minDecode on /api/best used to filter raw runs BEFORE aggregation,
// so reported medians were survivorship-biased above the threshold and
// contradicted the Find-HW UI's median-threshold semantics (and the handler's
// own docstring "only groups with median decode ≥ N tok/s"). minDecode now
// applies post-aggregation against the group's true all-runs median.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Rig A: 4 runs. Two fast (400 tok/s), two slow (200 tok/s).
// True median = 300 → must be EXCLUDED by minDecode=350.
// The old run-level filter deleted the two slow runs first and reported a
// bogus 400 median for the surviving pair.
const RIG_A = [200, 400, 200, 400].map((decode, i) => ({
  id: `a${i}`, batchSize: 1,
  tokSPrefill: 1000, tokSOut: decode,
  model: { hfId: 'test/Model-A', displayName: 'Model A', params: 8 },
  hardwareGroupKey: 'riga', hardwareGroupLabel: 'Rig A',
  hardware: { hwClass: 'discrete_gpu', gpuName: 'TestGPU A', gpuCount: 1, vramGb: 24 },
  engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
}));

// Rig B: 2 runs at 360 tok/s. True median 360 → INCLUDED by minDecode=350.
const RIG_B = [360, 360].map((decode, i) => ({
  id: `b${i}`, batchSize: 1,
  tokSPrefill: 1000, tokSOut: decode,
  model: { hfId: 'test/Model-B', displayName: 'Model B', params: 8 },
  hardwareGroupKey: 'rigb', hardwareGroupLabel: 'Rig B',
  hardware: { hwClass: 'discrete_gpu', gpuName: 'TestGPU B', gpuCount: 1, vramGb: 24 },
  engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
}));

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: [...RIG_A, ...RIG_B] }) });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const { default: handler } = await import('../api/_handlers/best.js');

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

test('#599: groups whose TRUE median is below minDecode are excluded even when some runs pass', async () => {
  const { json } = await call({ by: 'decode', minDecode: 350 });
  const keys = json.results.map(r => r.hardwareKey);
  assert.deepEqual(keys, ['rigb']);
});

test('#599: surviving groups report their true all-runs median, not a survivor median', async () => {
  const { json } = await call({ by: 'decode' }); // no filter — baseline
  const rigA = json.results.find(r => r.hardwareKey === 'riga');
  assert.equal(rigA.medianDecodeTokPerSec, 300);

  const filtered = await call({ by: 'decode', minDecode: 290 });
  const rigAFiltered = filtered.json.results.find(r => r.hardwareKey === 'riga');
  assert.ok(rigAFiltered, 'rig with median 300 survives minDecode=290');
  assert.equal(rigAFiltered.medianDecodeTokPerSec, 300, 'median must not inflate past the threshold');
  // matchedRuns keeps counting ALL runs of qualifying groups (no silent
  // run-level deletion), so the response is reproducible against raw data.
  assert.equal(rigAFiltered.runsInGroup, 4);
});

test('#599: effective minDecode is echoed at top level; null otherwise', async () => {
  const { json } = await call({ by: 'decode', minDecode: 290 });
  assert.equal(json.minDecode, 290);
  const bare = await call({ by: 'decode' });
  assert.equal(bare.json.minDecode, null);
});
