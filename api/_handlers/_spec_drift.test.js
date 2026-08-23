// OpenAPI schema drift tests: assert that the schemas/examples documented in
// /api/spec (./spec.js) match the actual wire fields emitted by the handlers.
// Direction of every check: documented fields ⊆ real response fields (the
// examples are not required to be exhaustive, but every field the spec shows
// or names must exist on the wire). Genuine drift is fixed in spec.js.
//
// Run: node --test api/_handlers/_spec_drift.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import specHandler from './spec.js';
import presetsHandler from './presets.js';
import healthHandler from './health.js';
import parseConstraintsHandler from './parse-constraints.js';
import snapshotsHandler from './snapshots.js';
import calcHandler from './calc_id.js';
import localmaxxingHandler from './localmaxxing.js';
import benchmarksHandler from './benchmarks.js';
import watchHandler from '../_watch_impl.js';
import vramHandler from './vram.js';
import computeHandler, { computeBody } from './compute.js';
import bestHandler, { bestBody } from './best.js';
import { invalidateCache } from '../_localmaxxing.js';
import { ERROR_CODES, problemType } from '../_errors.js';

// ---------- harness ----------

function mockRes() {
  const headers = new Map();
  let statusCode = 200;
  let endedBody = null;
  return {
    get headers() { return Object.fromEntries(headers); },
    get endedBody() { return endedBody; },
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    status(v) { statusCode = v; return this; },
    setHeader(k, v) { headers.set(k.toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    end(body) { endedBody = body ?? ''; }
  };
}

async function callHandler(handler, { query = {}, method = 'GET', body } = {}) {
  const req = { method, query, ...(body !== undefined ? { body } : {}), url: '/api/test' };
  const res = mockRes();
  await handler(req, res);
  let parsed = null;
  try { parsed = JSON.parse(res.endedBody); } catch { /* non-JSON */ }
  return { status: res.statusCode, body: parsed, headers: res.headers };
}

function getSpec() {
  return callHandler(specHandler);
}

/** Assert every key in `expected` exists on `actual` (top level). */
function assertKeysSubset(expected, actual, label) {
  const missing = expected.filter(k => !(k in (actual ?? {})));
  assert.deepEqual(missing, [], `${label}: wire response is missing documented field(s) ${JSON.stringify(missing)}`);
}

/** Collect every internal $ref in a JSON value. */
function collectRefs(node, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) collectRefs(v, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/')) out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

function resolveRef(spec, ref) {
  let node = spec;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) return undefined;
  }
  return node;
}

// ---------- spec document integrity ----------

test('spec is a valid OpenAPI 3.1 document and every internal $ref resolves', async () => {
  const { status, body: spec } = await getSpec();
  assert.equal(status, 200);
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.paths && Object.keys(spec.paths).length > 0);
  const refs = collectRefs(spec);
  assert.ok(refs.length > 0, 'spec contains internal refs');
  for (const ref of refs) {
    assert.notEqual(resolveRef(spec, ref), undefined, `dangling $ref: ${ref}`);
  }
});

test('x-error-codes mirror the ERROR_CODES registry exactly', async () => {
  const { body: spec } = await getSpec();
  const codes = spec['x-error-codes'].map(e => e.code);
  assert.deepEqual([...codes].sort(), Object.keys(ERROR_CODES).sort());
  for (const entry of spec['x-error-codes']) {
    assert.equal(entry.httpStatus, ERROR_CODES[entry.code].status, entry.code);
    assert.equal(entry.type, problemType(entry.code), entry.code);
    assert.equal(entry.title, ERROR_CODES[entry.code].title, entry.code);
  }
});

test('Problem schema required fields match what problemBody actually emits', async () => {
  const { body: spec } = await getSpec();
  const problem = spec.components.schemas.Problem;
  assert.deepEqual([...problem.required].sort(), ['code', 'status', 'title', 'type'].sort());
  // The enum of codes must track the registry (drift guard).
  assert.deepEqual([...problem.properties.code.enum].sort(), Object.keys(ERROR_CODES).sort());
});

test('every documented spec path is served by the /api router', async () => {
  const { body: spec } = await getSpec();
  const routerSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../[...path].js'), 'utf8');
  const cases = [...routerSrc.matchAll(/case '([^']+)':/g)].map(m => m[1]);
  const hasCalcRoute = /\/calc\\\/\(\[\^\/\]\+\)\$/.test(routerSrc) || routerSrc.includes("/calc/([^/]+)$");
  for (const path of Object.keys(spec.paths)) {
    const sub = path.replace(/^\/api/, '');
    const served = cases.includes(sub) || (sub.startsWith('/calc/') && hasCalcRoute);
    assert.ok(served, `spec documents ${path} but the router has no case for ${sub}`);
  }
});

// ---------- rate limiting contract ----------

test('429 body matches the documented RateLimited response schema', async () => {
  const { body: spec } = await getSpec();
  const schema = spec.components.responses.RateLimited.content['application/json'].schema;
  const documented = Object.keys(schema.properties);
  // Exhaust a real bucket via the limiter itself (RATE_LIMIT is read at
  // module load, so env vars won't do it here), then hit a handler with
  // that same client identity.
  const mod = await import('../_ratelimit.js');
  mod._resetRateLimits();
  for (let i = 0; i < mod.RATE_LIMIT; i++) mod.rateLimit('drift-429-test');
  // Drive clientKey identity via X-Forwarded-For.
  const req = { method: 'GET', query: {}, url: '/api/presets', headers: { 'x-forwarded-for': 'drift-429-test' } };
  const res = mockRes();
  presetsHandler(req, res);
  assert.equal(res.statusCode, 429);
  const exhausted = JSON.parse(res.endedBody);
  assertKeysSubset(documented, exhausted, '429 body vs RateLimited schema');
  // The RateLimited schema is exhaustive: no undocumented wire fields either.
  const extra = Object.keys(exhausted).filter(k => !documented.includes(k));
  assert.deepEqual(extra, [], '429 body carries undocumented field(s)');
  assert.ok(typeof res.headers['retry-after'] === 'string', 'Retry-After header present');
  mod._resetRateLimits();
});

test('every success response stamps X-RateLimit-* headers as documented', async () => {
  const r = await callHandler(presetsHandler);
  for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
    assert.ok(r.headers[h] !== undefined, `missing ${h}`);
  }
});

// ---------- /api/compute ----------

test('/api/compute singleTurn wire fields cover the documented example', async () => {
  const { body: spec } = await getSpec();
  const example = spec.paths['/api/compute'].get.responses['200'].content['application/json'].example;
  // Go through the real handler so schema_version/X-Schema-Version stamping applies.
  const r = await callHandler(computeHandler, { query: { model: 'singleTurn', promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 } });
  assert.equal(r.status, 200);
  assertKeysSubset(Object.keys(example), r.body, '/api/compute example vs wire');
  assert.match(r.body.id, /^calc_[0-9a-f]{12}$/);
  assert.equal(r.body.schema_version, '1');
});

test('/api/compute dry_run wire shape matches the documented { dry_run, model, inputs, id?, note }', async () => {
  const { status, body } = computeBody({ model: 'singleTurn', promptTokens: 10, dry_run: 'true' });
  assert.equal(status, 200);
  assertKeysSubset(['dry_run', 'model', 'inputs', 'note'], body, 'dry_run body');
  assert.equal(body.dry_run, true);
});

test('/api/compute speculative exposes breakevenAcceptanceRate as documented', async () => {
  const { body } = computeBody({ model: 'speculative', draftTokens: 4, acceptanceRate: 0.7 });
  assert.ok('breakevenAcceptanceRate' in body);
});

test('/api/compute model enum matches the models the handler accepts', async () => {
  const { body: spec } = await getSpec();
  const documented = spec.paths['/api/compute'].get.parameters.find(p => p.name === 'model').schema.enum;
  // Unknown models are rejected with INVALID_PARAMS (problem+json).
  assert.throws(() => computeBody({ model: 'nope' }), err => err.code === 'INVALID_PARAMS' && err.status === 400);
  // The self-describing capability list is the wire truth about supported models.
  const { body: caps } = computeBody({});
  assert.deepEqual([...documented].sort(), Object.keys(caps.models).sort());
});

// ---------- /api/presets ----------

test('/api/presets wire fields cover the documented example + power guidance', async () => {
  const { body: spec } = await getSpec();
  const example = spec.paths['/api/presets'].get.responses['200'].content['application/json'].example;
  const r = await callHandler(presetsHandler);
  assert.equal(r.status, 200);
  assertKeysSubset(Object.keys(example), r.body, '/api/presets top level');
  assert.ok(r.body.hardware.length > 0);
  for (const hw of example.hardware) {
    assertKeysSubset(Object.keys(hw), r.body.hardware[0], '/api/presets hardware entry');
  }
  for (const sc of example.scenarios) {
    assertKeysSubset(Object.keys(sc), r.body.scenarios[0], '/api/presets scenario entry');
  }
  // Power guidance fields named in the 200 description (#69)
  assertKeysSubset(['tdpWatts', 'loadWatts', 'psuWatts', 'powerNote'], r.body.hardware[0], 'presets power fields');
});

// ---------- /api/localmaxxing ----------

const MOCK_ROWS = [
  {
    id: 'r1', createdAt: '2026-08-01T00:00:00.000Z',
    tokSPrefill: 3820, tokSOut: 108, contextLength: 8192, promptTokens: 2048, outputTokens: 512,
    hardwareGroupKey: 'rtx4090', hardwareGroupLabel: 'RTX 4090 24GB',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    model: { hfId: 'unsloth/Qwen3.6-27B-MTP-GGUF', displayName: 'Qwen3.6 27B MTP', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1
  },
  {
    id: 'r2', createdAt: '2026-08-10T00:00:00.000Z',
    tokSPrefill: 3600, tokSOut: 99, contextLength: 8192,
    hardwareGroupKey: 'rtx4090', hardwareGroupLabel: 'RTX 4090 24GB',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    model: { hfId: 'unsloth/Qwen3.6-27B-MTP-GGUF', displayName: 'Qwen3.6 27B MTP', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1
  }
];

async function withMockedUpstream(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: MOCK_ROWS }) });
  invalidateCache();
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCache();
  }
}

test('/api/localmaxxing paginated list wire fields cover the documented example', async () => {
  const { body: spec } = await getSpec();
  const example = spec.paths['/api/localmaxxing'].get.responses['200'].content['application/json'].example;
  await withMockedUpstream(async () => {
    const r = await callHandler(localmaxxingHandler, { query: { hardware: 'rtx4090' } });
    assert.equal(r.status, 200);
    assertKeysSubset(['total', 'items', 'has_more', 'next_cursor', 'caveats', 'snapshot', 'snapshotAt', 'schema_version'], r.body, '/api/localmaxxing top level');
    assert.ok(r.body.items.length > 0);
    assertKeysSubset(Object.keys(example.items[0]), r.body.items[0], '/api/localmaxxing run item');
    // caveats contract: objects with code/severity/summary/detail
    assert.ok(Array.isArray(r.body.caveats) && r.body.caveats.length > 0);
    for (const c of r.body.caveats) assertKeysSubset(['code', 'severity', 'summary', 'detail'], c, 'caveat entry');
    // snapshot shape documented in the example
    assertKeysSubset(['id', 'createdAt', 'runCount'], r.body.snapshot, 'snapshot block');
  });
});

// ---------- /api/benchmarks ----------

test('/api/benchmarks group wire fields cover the documented example', async () => {
  const { body: spec } = await getSpec();
  const example = spec.paths['/api/benchmarks'].get.responses['200'].content['application/json'].example;
  await withMockedUpstream(async () => {
    const r = await callHandler(benchmarksHandler, { query: {} });
    assert.equal(r.status, 200);
    assertKeysSubset(['total', 'items', 'has_more', 'next_cursor', 'caveats', 'snapshot', 'snapshotAt', 'schema_version'], r.body, '/api/benchmarks top level');
    const item = r.body.items[0];
    assert.ok(item, 'benchmarks returned at least one group');
    assertKeysSubset(Object.keys(example.items[0]), item, '/api/benchmarks group item');
    // stat blocks: q1/median/q3/min/max + ci95 {lo,hi} + label
    for (const stat of ['prefill', 'decode']) {
      assertKeysSubset(['q1', 'median', 'q3', 'min', 'max', 'ci95', 'label'], item[stat], `benchmarks ${stat} block`);
      assertKeysSubset(['lo', 'hi'], item[stat].ci95, `benchmarks ${stat}.ci95`);
      // 95% CI actually brackets the median
      assert.ok(item[stat].ci95.lo <= item[stat].median && item[stat].median <= item[stat].ci95.hi, `${stat} ci95 brackets median`);
    }
    assertKeysSubset(['runs', 'iqrSpreadPct', 'outliers', 'newestRunAgeDays', 'grade'], item.confidence, 'confidence block');
    assertKeysSubset(['relatedRigComparisons', 'contradictions'], item.crossCheck, 'crossCheck block');
  });
});

// ---------- /api/best ----------

test('/api/best wire fields cover the documented example incl. pricing/explain/power', async () => {
  const { body: spec } = await getSpec();
  const example = spec.paths['/api/best'].get.responses['200'].content['application/json'].example;
  await withMockedUpstream(async () => {
    // Through the real handler so schema_version stamping applies.
    const r = await callHandler(bestHandler, { query: { by: 'decode' } });
    assert.equal(r.status, 200);
    assertKeysSubset(Object.keys(example), r.body, '/api/best top level');
    assert.match(r.body.id, /^calc_[0-9a-f]{12}$/);
    assert.equal(r.body.rankedBy, 'decode');
    assert.ok(r.body.results.length > 0);
    const row = r.body.results[0];
    assertKeysSubset(Object.keys(example.results[0]), row, '/api/best result row');
    // fields promised by the 200 description but not in the example
    assertKeysSubset(['power', 'explain', 'effectiveVramGb'], row, '/api/best row extras');
    assert.equal(typeof row.explain, 'string', 'explain is a string');
    assert.ok(row.explain.length > 0, 'explain is non-empty');
    // pricing shape documented in the description
    if (row.pricing) {
      assertKeysSubset(['estimateUsd', 'lowUsd', 'highUsd', 'perGpu', 'asOf', 'links'], row.pricing, 'pricing block');
    }
    if (row.power) {
      assert.ok(typeof row.power === 'object', 'power is an object');
    }
  });
});

test('/api/best ?by= accepts every rank mode the handler supports (drift: enum)', async () => {
  const { body: spec } = await getSpec();
  const enumDoc = spec.paths['/api/best'].get.parameters.find(p => p.name === 'by').schema.enum;
  // Wire truth from best.js: BY_MODES + cost.
  for (const mode of ['decode', 'prefill', 'efficiency', 'walltime', 'confidence', 'cost']) {
    await withMockedUpstream(async () => {
      const { status, body } = await bestBody({ by: mode });
      assert.equal(status, 200, `by=${mode} should be accepted`);
      assert.equal(body.rankedBy, mode);
    });
    assert.ok(enumDoc.includes(mode), `spec enum for /api/best ?by= is missing wire-supported mode '${mode}'`);
  }
});

// ---------- /api/health ----------

test('/api/health wire fields match the documented {ok, service, time, upstreamFreshness, cacheAge}', async () => {
  const r = await callHandler(healthHandler);
  assert.equal(r.status, 200);
  assertKeysSubset(['ok', 'service', 'time', 'upstreamFreshness', 'cacheAge'], r.body, '/api/health');
  assertKeysSubset(['status', 'fetchedAt', 'ageSeconds', 'ttlSeconds', 'rowCount', 'source'], r.body.upstreamFreshness, 'upstreamFreshness');
});

// ---------- /api/parse-constraints ----------

function validateAgainstSchema(value, schema, path, errors) {
  if (schema.type === 'object' && schema.properties) {
    assert.equal(typeof value, 'object', `${path} should be an object`);
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (value[k] === undefined && sub.nullable !== true && !(sub.type && value[k] == null)) {
        // only flag keys the wire should always carry
        if (!(k in value)) errors.push(`${path}.${k} documented but absent on wire`);
      }
      if (k in value && value[k] !== null && sub.type) {
        const t = Array.isArray(value[k]) ? 'array' : typeof value[k];
        const expected = sub.type === 'integer' ? 'number' : sub.type;
        if (t !== expected && !(sub.nullable && value[k] === null)) {
          errors.push(`${path}.${k} wire type ${t} != documented ${sub.type}`);
        }
      }
      if (k in value && value[k] && typeof value[k] === 'object' && !Array.isArray(value[k]) && sub.properties) {
        validateAgainstSchema(value[k], sub, `${path}.${k}`, errors);
      }
    }
  }
}

test('/api/parse-constraints response validates against its inline OpenAPI schema', async () => {
  const { body: spec } = await getSpec();
  const schema = spec.paths['/api/parse-constraints'].get.responses['200'].content['application/json'].schema;
  const r = await callHandler(parseConstraintsHandler, { query: { q: 'self-hosted Qwen 27B at Q4 for 10 users under $1500' } });
  assert.equal(r.status, 200);
  const errors = [];
  validateAgainstSchema(r.body, schema, 'response', errors);
  assert.deepEqual(errors, []);
  // documented contract details
  assert.equal(r.body.input, 'self-hosted Qwen 27B at Q4 for 10 users under $1500');
  assert.ok(Array.isArray(r.body.ambiguities));
  for (const a of r.body.ambiguities) assertKeysSubset(['field', 'message'], a, 'ambiguity entry');
  assert.ok(r.body.recognizedCount >= 1);
  assert.ok(typeof r.body.sizingQuery === 'string' && r.body.sizingQuery.startsWith('/api/sizing?'));
});

// ---------- /api/snapshots ----------

test('/api/snapshots wire fields match the documented {current, snapshots[]}', async () => {
  await withMockedUpstream(async () => {
    const r = await callHandler(snapshotsHandler);
    assert.equal(r.status, 200);
    assertKeysSubset(['current', 'snapshots'], r.body, '/api/snapshots');
    assert.equal(typeof r.body.current, 'string');
    assert.ok(Array.isArray(r.body.snapshots));
    for (const s of r.body.snapshots) assertKeysSubset(['id', 'createdAt', 'runCount'], s, 'snapshot entry');
  });
});

// ---------- /api/calc/{id} ----------

test('/api/calc replay stamps verified:true and mismatch returns expected id (as documented)', async () => {
  await withMockedUpstream(async () => {
    const { body: computeOut } = computeBody({ model: 'singleTurn', promptTokens: 4096, outputTokens: 512 });
    const good = await callHandler(calcHandler, { query: { id: computeOut.id, model: 'singleTurn', promptTokens: 4096, outputTokens: 512 } });
    assert.equal(good.status, 200);
    assert.equal(good.body.verified, true, 'replay carries verified:true');
    assert.equal(good.body.id, computeOut.id);

    const bad = await callHandler(calcHandler, { query: { id: computeOut.id, model: 'singleTurn', promptTokens: 1 } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.expected, /^calc_[0-9a-f]{12}$/, 'mismatch body carries an expected id');
    assert.notEqual(bad.body.expected, computeOut.id, 'expected id reflects the altered parameters, not the requested one');
  });
});

// ---------- /api/vram ----------

test('/api/vram wire fields match the documented weights/kv/total breakdown + fits + projection', async () => {
  // meta-llama/Llama-3.1-8B-Instruct resolves from the built-in table (offline).
  const r = await callHandler(vramHandler, { query: { hfId: 'meta-llama/Llama-3.1-8B-Instruct' } });
  assert.equal(r.status, 200);
  assertKeysSubset(['inputs', 'model', 'weights', 'kvCache', 'total', 'contextWindow', 'fits', 'projection'], r.body, '/api/vram');

  const budget = await callHandler(vramHandler, { query: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', vramGb: 24 } });
  assert.equal(budget.status, 200);
  assertKeysSubset(['fits', 'maxContextTokens'], budget.body.fits, 'fits block (vramGb budget → fits flag + max context)');

  const proj = await callHandler(vramHandler, { query: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', numTurns: 20, tokensPerTurn: 2000, vramGb: 8 } });
  assert.equal(proj.status, 200);
  assertKeysSubset(['turns', 'firstContextOverflowTurn', 'firstVramOverflowTurn'], proj.body.projection, 'per-turn KV projection with exact overflow turn');
});

// ---------- /api/watch ----------

test('/api/watch GET wire fields match the documented listing shape', async () => {
  const r = await callHandler(watchHandler, { method: 'GET' });
  assert.equal(r.status, 200);
  assertKeysSubset(['maxWatches', 'totalWatches', 'watches'], r.body, '/api/watch listing');
  // never exposes secrets or webhook URLs (documented guarantee)
  if (r.body.watches.length) {
    for (const w of r.body.watches) {
      assertKeysSubset(['watchId', 'label', 'hasWebhook', 'createdAt'], w, 'watch entry');
      assert.ok(!('secret' in w) && !('webhookUrl' in w), 'listing must not leak secret/webhookUrl');
    }
  }
});
