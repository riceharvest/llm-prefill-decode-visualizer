import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Issue #974: param VALUE case contract — enum values on /api/best (?by= /
// ?sort_by=) and /api/benchmarks (?groupBy=) are matched case-insensitively
// (same value-case contract as scenario= ids), with an observable warnings[]
// entry when casing was normalized. Unknown values keep the old silent
// default so nothing breaks.

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

async function callHandler(handler, query = {}) {
  const req = { method: 'GET', query };
  const res = mockRes();
  await handler(req, res);
  assert.ok(res.body, 'handler should write a JSON body');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

test('#974: best ?by=CONFIDENCE ranks by confidence instead of silently decoding', async () => {
  const best = (await import('../api/_handlers/best.js')).default;
  const upper = await callHandler(best, { by: 'CONFIDENCE' });
  assert.equal(upper.json.rankedBy, 'confidence');
  assert.ok(
    upper.json.warnings.some(w => String(w).includes("matched case-insensitively as 'confidence'")),
    'case normalization should be flagged in warnings[]'
  );

  // Lowercase spelling is unchanged and emits no coercion warning.
  const lower = await callHandler(best, { by: 'confidence' });
  assert.equal(lower.json.rankedBy, 'confidence');
  assert.equal(lower.json.warnings.filter(w => String(w).includes('case-insensitively')).length, 0);
});

test('#974: best ?sort_by=PREFILL alias is also case-insensitive', async () => {
  const best = (await import('../api/_handlers/best.js')).default;
  const r = await callHandler(best, { sort_by: 'PREFILL' });
  assert.equal(r.json.rankedBy, 'prefill');
  assert.ok(r.json.warnings.some(w => String(w).includes("'prefill'")));
});

test('#974: unknown by= value still silently defaults to decode with no warning', async () => {
  const best = (await import('../api/_handlers/best.js')).default;
  const r = await callHandler(best, { by: 'BOGUS' });
  assert.equal(r.json.rankedBy, 'decode');
  assert.equal(r.json.warnings.filter(w => String(w).includes('case-insensitively')).length, 0);
});

test('#974: benchmarks ?groupBy=MODEL regroups instead of silently defaulting', async () => {
  const benchmarks = (await import('../api/_handlers/benchmarks.js')).default;
  const upper = await callHandler(benchmarks, { groupBy: 'MODEL' });
  assert.ok(upper.json.items?.length || upper.json.total >= 0); // sanity: served
  assert.ok(
    upper.json.warnings.some(w => String(w).includes("?groupBy=MODEL matched case-insensitively as 'model'")),
    `expected coercion warning, got: ${JSON.stringify(upper.json.warnings)}`
  );
  // Group keys under model grouping look like model families, not hardware×model.
  assert.ok(upper.json.items.every(g => !g.key.includes(':')));

  const camel = await callHandler(benchmarks, { groupBy: 'HardwareModel' });
  assert.ok(camel.json.warnings.some(w => String(w).includes("'hardwareModel'")));

  // Exact spellings stay warning-free.
  const exact = await callHandler(benchmarks, { groupBy: 'hardwareModel' });
  assert.equal(exact.json.warnings.filter(w => String(w).includes('case-insensitively')).length, 0);

  // Unknown values still default to hardwareModel with no coercion warning.
  const bogus = await callHandler(benchmarks, { groupBy: 'NOPE' });
  assert.equal(bogus.json.engineCohortedByDefault, true); // == hardwareModel default
  assert.equal(bogus.json.warnings.filter(w => String(w).includes('case-insensitively')).length, 0);
});
