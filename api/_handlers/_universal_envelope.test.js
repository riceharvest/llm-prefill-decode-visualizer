// #567 — documented universal response contract: schema_version / rate_limit
// / snapshot must be present on /api/sizing, /api/diff, /api/health and
// /api/snapshots bodies (they previously used private json() senders that
// bypassed _schema.js sendJson()).
//
// Run: node --test api/_handlers/_universal_envelope.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import sizingHandler from './sizing.js';
import diffHandler from './diff.js';
import healthHandler from './health.js';
import snapshotsHandler from './snapshots.js';
import { invalidateCache } from '../_localmaxxing.js';
import { resetSnapshots } from '../_snapshots.js';

function mockRes({ rateLimitInfo = null } = {}) {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    rateLimitInfo,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

function row(id, { decode = 100, prefill = 4000, rig = `rig-${id}` } = {}) {
  return {
    id,
    batchSize: 1,
    tokSPrefill: prefill,
    tokSOut: decode,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    hardwareGroupKey: rig,
    hardwareGroupLabel: `Rig ${id}`,
    hardware: { hwClass: 'discrete_gpu', gpuName: 'GPU', gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' },
    model: { hfId: 'llama-3-8b', displayName: 'Llama 3 8B', params: 8 }
  };
}

let realFetch;
before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: [row(101), row(102)] }) });
});
after(() => {
  globalThis.fetch = realFetch;
});

async function call(handler, { method = 'GET', query = {}, body, rateLimitInfo } = {}) {
  invalidateCache();
  const res = mockRes({ rateLimitInfo });
  await handler({ method, query, body }, res);
  assert.ok(res.body, 'handler should write a JSON body');
  return { status: res.statusCode, json: JSON.parse(res.body), headers: res.headers };
}

// A realistic per-window limiter state like enforceRateLimit stamps onto res.
const RL = { allowed: true, limit: 120, remaining: 117, resetEpochSec: 1900000000, retryAfterSec: 60 };

test('#567 /api/sizing success body carries schema_version + rate_limit + snapshot', async () => {
  const r = await call(sizingHandler, { query: { model: 'llama' }, rateLimitInfo: RL });
  assert.equal(r.status, 200);
  assert.equal(r.json.schema_version, '1');
  assert.equal(r.headers['X-Schema-Version'], '1');
  assert.ok(r.json.rate_limit, 'rate_limit object missing from sizing body');
  assert.equal(r.json.rate_limit.limit, 120);
  // The documented universal envelope: every data endpoint carries a snapshot object.
  assert.ok(r.json.snapshot, 'snapshot object missing from sizing body');
  assert.match(r.json.snapshot.id, /^snapshot-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);
  assert.deepEqual(Object.keys(r.json.snapshot).sort(), ['createdAt', 'id', 'runCount']);
});

test('#567 /api/diff success body carries schema_version + rate_limit', async () => {
  const r = await call(diffHandler, { query: { runA: '101', runB: '102' }, rateLimitInfo: RL });
  assert.equal(r.status, 200);
  assert.equal(r.json.schema_version, '1');
  assert.equal(r.headers['X-Schema-Version'], '1');
  assert.ok(r.json.rate_limit, 'rate_limit object missing from diff body');
  assert.ok(r.json.diff.metrics.tpot.winner !== undefined);
});

test('#567 /api/health body carries schema_version + header, keeps no-store', async () => {
  const r = await call(healthHandler, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.schema_version, '1');
  assert.equal(r.headers['X-Schema-Version'], '1');
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(r.json.ok, true);
});

test('#567 /api/snapshots body carries schema_version + rate_limit', async () => {
  resetSnapshots();
  const r = await call(snapshotsHandler, { query: {}, rateLimitInfo: RL });
  assert.equal(r.status, 200);
  assert.equal(r.json.schema_version, '1');
  assert.equal(r.headers['X-Schema-Version'], '1');
  assert.ok(r.json.rate_limit, 'rate_limit object missing from snapshots body');
  assert.match(r.json.current, /^snapshot-/);
});
