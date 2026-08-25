// Issue #661 — /api/best response slimming: ?warnings= and ?fields= must let
// token-budgeted agents shrink responses without changing ranking or ids.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock the upstream leaderboard BEFORE importing the handler (same pattern as
// lib/best.test.js) so getAllRuns() never touches the network.
const ROWS = [
  {
    id: 'a1', batchSize: 1,
    tokSPrefill: 2000, tokSOut: 100,
    model: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B', params: 8 },
    hardwareGroupKey: 'riga', hardwareGroupLabel: 'Rig A',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'TestGPU A', gpuCount: 1, vramGb: 24 },
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

const { bestBody } = await import('./_handlers/best.js');

test('default body still carries the warnings array (back-compat)', async () => {
  const { status, body } = await bestBody({ limit: '5' });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.warnings), 'warnings array present by default');
  assert.equal(body.warningsOmitted, undefined);
  assert.ok(Array.isArray(body.results) && body.results.length > 0);
});

test('?warnings=false omits warnings and echoes warningsOmitted (#661)', async () => {
  for (const v of ['false', 'none', '0']) {
    const { body } = await bestBody({ limit: '5', warnings: v });
    assert.equal(body.warnings, undefined, `warnings dropped for warnings=${v}`);
    assert.equal(body.warningsOmitted, true);
  }
});

test('?fields projects each row to only requested existing keys (#661)', async () => {
  const wanted = ['hardware', 'medianDecodeTokPerSec', 'notARealField'];
  const { body } = await bestBody({ limit: '5', fields: wanted.join(',') });
  assert.deepEqual(body.fieldsApplied.sort(), ['hardware', 'medianDecodeTokPerSec'].sort());
  for (const row of body.results) {
    assert.deepEqual(Object.keys(row).sort(), ['hardware', 'medianDecodeTokPerSec'].sort());
    assert.equal(typeof row.hardware, 'string');
  }
});

test('slimming is presentation-only: calc id and ranking unchanged', async () => {
  const q = { by: 'decode', maxParamsB: '8' };
  const full = await bestBody(q);
  const slim = await bestBody({ ...q, warnings: 'false', fields: 'hardware,medianDecodeTokPerSec' });
  assert.equal(full.body.id, slim.body.id, 'deterministic id ignores presentation params');
  assert.deepEqual(
    full.body.results.map(r => r.hardware),
    slim.body.results.map(r => r.hardware),
    'same rows in same order'
  );
});
