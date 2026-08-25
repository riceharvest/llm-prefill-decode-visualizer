import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Regression tests for issue #847: /api/diff whatif honors `limit` PER
// constraint set — asymmetric top-N truncation used to be reported as
// options entering/leaving the feasible set with no truncation signal.
// The fix surfaces effective per-side limits + truncated flags + warnings.

// 8 distinct rigs so a limit=3 leg is provably cut while the other side
// (default 50) returns all 8.
const ROWS = Array.from({ length: 8 }, (_, i) => ({
  id: `run${i + 1}`, batchSize: 1,
  tokSPrefill: 2000 + i * 100, tokSOut: 100 - i * 5,
  model: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B', params: 8 },
  hardwareGroupKey: `rig${i + 1}`, hardwareGroupLabel: `Rig ${i + 1}`,
  hardware: { hwClass: 'discrete_gpu', gpuName: `TestGPU ${i + 1}`, gpuCount: 1, vramGb: 24 },
  engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
}));

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS }) });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const { default: handler } = await import('./_handlers/diff.js');

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

async function callWhatIf(query) {
  const res = mockRes();
  await handler({ method: 'GET', query: { mode: 'whatif', ...query } }, res);
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  return JSON.parse(res.body);
}

test('#847: per-side limits are echoed and truncation is flagged', async () => {
  const json = await callWhatIf({ a: 'limit=3', b: 'hwClass=discrete_gpu' });
  assert.equal(json.limits.a, 3);
  assert.equal(json.limits.b, 50); // shared default
  assert.equal(json.a.limit, 3);
  assert.equal(json.a.truncated, true);
  assert.equal(json.b.truncated, false);
  assert.deepEqual(json.truncated, { a: true, b: false });

  // The bug manifestation: rigs ranked 4-8 under B are reported as entered
  // purely because A was cut at 3 — the warning must say so.
  const codes = (json.warnings || []).map(w => w.code);
  assert.ok(codes.includes('whatif_limit_mismatch'), 'asymmetric limits must warn');
  assert.ok(codes.includes('whatif_truncated'), 'cap-reached side must warn');
  assert.match(json.warnings.find(w => w.code === 'whatif_truncated').message, /rank-cutoff|top-N cap/i);
});

test('#847: symmetric untruncated comparison carries no warnings and stays stable', async () => {
  const json = await callWhatIf({ a: 'fitCheck=true', b: 'fitCheck=true&contextLength=65536' });
  assert.equal(json.limits.a, 50);
  assert.equal(json.limits.b, 50);
  assert.deepEqual(json.truncated, { a: false, b: false });
  assert.equal(json.warnings, undefined, 'no warnings key when neither side hits the cap');
  // Pre-existing fields unchanged.
  assert.equal(json.mode, 'whatif');
  assert.ok(json.delta && typeof json.delta.counts === 'object');
});

test('#847: explicit shared ?limit= applies to both legs without mismatch warning', async () => {
  const json = await callWhatIf({ a: 'hwClass=discrete_gpu', b: 'hwClass=discrete_gpu', limit: '2' });
  assert.equal(json.limits.a, 2);
  assert.equal(json.limits.b, 2);
  assert.equal(json.a.resultCount, 2);
  const codes = (json.warnings || []).map(w => w.code);
  assert.ok(!codes.includes('whatif_limit_mismatch'), 'same limit on both sides is not a mismatch');
  assert.ok(codes.includes('whatif_truncated'), 'but the cap is reached → truncation warning');
});

test('#847: description documents the per-side N semantics', async () => {
  const json = await callWhatIf({ a: 'hwClass=discrete_gpu', b: 'hwClass=discrete_gpu' });
  assert.match(json.description, /PER SET/i);
  assert.match(json.description, /#847/);
});
