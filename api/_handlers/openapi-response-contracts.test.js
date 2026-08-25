// Regression tests for the OpenAPI response-contract fixes:
//   #999  — BestListEnvelope.rankedBy enum must cover every ?by=/sort_by= mode
//           the handler accepts (wire returns 'efficiency'/'confidence' too).
//   #1000 — POST /api/compute must be spec'd, and its 200 body typed as the
//           real batch envelope (BatchComputeResponse), not ComputeResponse.
//   #1001 — the 8 paths that return documented JSON/XML bodies must declare
//           response `content` schemas so generated clients don't type them
//           as never.
//
// Run: node --test api/_handlers/openapi-response-contracts.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import specHandler from './spec.js';
import healthHandler from './health.js';
import snapshotsHandler from './snapshots.js';
import { computeBody } from './compute.js';
import { bestBody } from './best.js';
import { invalidateCache } from '../_localmaxxing.js';

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

async function getSpec() {
  return callHandler(specHandler);
}

const MOCK_ROWS = [
  {
    id: 'r1', createdAt: '2026-08-01T00:00:00.000Z',
    tokSPrefill: 3820, tokSOut: 108, contextLength: 8192,
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

// Minimal documented⊆wire walker (same policy as _spec_drift.test.js).
function collectDrift(value, schema, path, errors) {
  if (!schema || schema.type !== 'object' || !schema.properties) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  for (const [k, sub] of Object.entries(schema.properties)) {
    if (!(k in value)) {
      if ((schema.required || []).includes(k)) errors.push(`${path}.${k} documented+required but absent on wire`);
      continue;
    }
    if (value[k] === null) continue;
    if (sub.type && !Array.isArray(sub.type)) {
      const t = Array.isArray(value[k]) ? 'array' : typeof value[k];
      const expected = sub.type === 'integer' ? 'number' : sub.type;
      if (t !== expected && !(sub.nullable && value[k] === null)) {
        errors.push(`${path}.${k} wire type ${t} != documented ${sub.type}`);
      }
    } else if (Array.isArray(sub.type)) {
      const t = Array.isArray(value[k]) ? 'array' : typeof value[k];
      const allowed = sub.type.map(x => (x === 'integer' ? 'number' : x));
      if (!allowed.includes(t)) errors.push(`${path}.${k} wire type ${t} not in documented [${sub.type}]`);
    }
    if (value[k] && typeof value[k] === 'object' && !Array.isArray(value[k])) {
      collectDrift(value[k], sub.properties ? sub : {}, `${path}.${k}`, errors);
    }
  }
}

// ---------- #999 ----------

test('#999: rankedBy enum covers every rank mode the handler emits on the wire', async () => {
  const { body: spec } = await getSpec();
  const rankedBy = spec.components.schemas.BestListEnvelope.properties.rankedBy;
  for (const mode of ['decode', 'prefill', 'efficiency', 'walltime', 'cost', 'confidence']) {
    assert.ok(rankedBy.enum.includes(mode), `rankedBy enum missing wire-supported mode '${mode}'`);
  }
  await withMockedUpstream(async () => {
    for (const mode of ['efficiency', 'confidence']) {
      const { status, body } = await bestBody({ by: mode });
      assert.equal(status, 200);
      assert.equal(body.rankedBy, mode);
      assert.ok(rankedBy.enum.includes(body.rankedBy), `wire rankedBy '${body.rankedBy}' violates the declared enum`);
    }
  });
});

// ---------- #1000 ----------

test('#1000: POST /api/compute is declared and typed as the batch envelope', async () => {
  const { body: spec } = await getSpec();
  const post = spec.paths['/api/compute'].post;
  assert.ok(post, '/api/compute should declare a post operation');
  const resp = post.responses['200'].content['application/json'].schema;
  assert.equal(resp.$ref, '#/components/schemas/BatchComputeResponse');

  // Wire truth: batch envelope fields ⊆ declared schema.
  const schema = spec.components.schemas.BatchComputeResponse;
  assert.ok(schema, 'BatchComputeResponse schema should exist');
  const { status, body } = computeBody({
    batch: [
      { model: 'singleTurn', promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 },
      { model: 'nope' } // per-item failure stays inline
    ]
  });
  assert.equal(status, 200);
  const errors = [];
  collectDrift(body, schema, 'batch', errors);
  assert.deepEqual(errors, []);
  assert.equal(body.errorCount, 1);
  assert.equal(body.results[0].ok, true);
  assert.equal(body.results[1].ok, false);
  // Single-item result shape matches ComputeResult's documented core.
  const itemErrors = [];
  collectDrift(body.results[0].result, spec.components.schemas.ComputeResult, 'result', itemErrors);
  assert.deepEqual(itemErrors, []);
});

// ---------- #1001 ----------

test('#1001: every path that documents a JSON/XML body declares response content', async () => {
  const { body: spec } = await getSpec();
  const expectations = [
    ['/api/vram', 'get', '200'],
    ['/api/sizing', 'get', '200'],
    ['/api/health', 'get', '200'],
    ['/api/snapshots', 'get', '200'],
    ['/api/calc/{id}', 'get', '200'],
    ['/api/watch', 'get', '200'],
    ['/api/watch', 'post', '201'],
    ['/api/watch/rss.xml', 'get', '200'],
    ['/api/watch/dispatch', 'get', '200']
  ];
  for (const [path, method, code] of expectations) {
    const op = spec.paths[path]?.[method];
    assert.ok(op, `${method.toUpperCase()} ${path} should exist`);
    const content = op.responses[code].content;
    assert.ok(content && Object.keys(content).length > 0, `${method.toUpperCase()} ${path} ${code} should declare content`);
    for (const media of Object.values(content)) {
      assert.ok(media.schema, `${method.toUpperCase()} ${path} ${code} content should carry a schema`);
    }
  }
});

test('#1001: /api/health wire validates against its new declared schema', async () => {
  const { body: spec } = await getSpec();
  const schema = spec.paths['/api/health'].get.responses['200'].content['application/json'].schema;
  const r = await callHandler(healthHandler);
  assert.equal(r.status, 200);
  const errors = [];
  collectDrift(r.body, schema, 'health', errors);
  assert.deepEqual(errors, []);
});

test('#1001: /api/snapshots wire validates against its new declared schema', async () => {
  const { body: spec } = await getSpec();
  const schema = spec.paths['/api/snapshots'].get.responses['200'].content['application/json'].schema;
  await withMockedUpstream(async () => {
    const r = await callHandler(snapshotsHandler);
    assert.equal(r.status, 200);
    const errors = [];
    collectDrift(r.body, schema, 'snapshots', errors);
    assert.deepEqual(errors, []);
    assert.ok(Array.isArray(r.body.snapshots) && r.body.snapshots.length > 0);
  });
});

test('#1001: GET /api/compute single-call 200 still types as ComputeResponse', async () => {
  const { body: spec } = await getSpec();
  const ref = spec.paths['/api/compute'].get.responses['200'].content['application/json'].schema.$ref;
  assert.equal(ref, '#/components/schemas/ComputeResponse');
});
