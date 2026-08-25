// #570 — RFC 9457 error contract: /api/diff, /api/sizing and the
// /api/localmaxxing POST validator must serve application/problem+json with a
// stable `code`, while preserving their legacy flat members (error, detail,
// example, hint, workload, errors) so existing clients keep parsing.
//
// Run: node --test api/_handlers/_problem_contract.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import diffHandler from './diff.js';
import sizingHandler from './sizing.js';
import localmaxxingHandler from './localmaxxing.js';
import { invalidateCache } from '../_localmaxxing.js';

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

function row(id) {
  return {
    id,
    batchSize: 1,
    tokSPrefill: 4000,
    tokSOut: 100,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    hardwareGroupKey: `rig-${id}`,
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

async function call(handler, req) {
  invalidateCache();
  const res = mockRes();
  await handler(req, res);
  return {
    status: res.statusCode,
    json: res.body ? JSON.parse(res.body) : null,
    contentType: res.headers['Content-Type'] || ''
  };
}

function assertProblem(r, { status, code }) {
  assert.equal(r.status, status);
  assert.ok(r.contentType.startsWith('application/problem+json'), `content-type should be problem+json, got ${r.contentType}`);
  for (const member of ['type', 'title', 'status', 'code']) {
    assert.ok(member in r.json, `problem body missing "${member}"`);
  }
  assert.equal(r.json.status, status);
  assert.equal(r.json.code, code);
  assert.match(r.json.type, /\/problems\/[a-z-]+$/);
}

test('#570 GET /api/diff missing params → problem+json INVALID_PARAMS with legacy fields', async () => {
  const r = await call(diffHandler, { method: 'GET', query: {}, headers: {} });
  assertProblem(r, { status: 400, code: 'INVALID_PARAMS' });
  // legacy members preserved
  assert.equal(r.json.error, 'missing parameters');
  assert.match(r.json.detail, /runA=<id>&runB=<id>/);
  assert.equal(r.json.example, '/api/diff?runA=cmsxu9zyi0ck7ms01v41wipnd&runB=cmrpa80mz05aolg011rjzkfvk');
});

test('#570 GET /api/diff identical ids → problem+json INVALID_PARAMS', async () => {
  const r = await call(diffHandler, { method: 'GET', query: { runA: '101', runB: '101' }, headers: {} });
  assertProblem(r, { status: 400, code: 'INVALID_PARAMS' });
  assert.equal(r.json.error, 'runA and runB must be different run ids');
});

test('#570 GET /api/diff unknown run → problem+json NOT_FOUND with legacy error + hint', async () => {
  const r = await call(diffHandler, { method: 'GET', query: { runA: '999', runB: '101' }, headers: {} });
  assertProblem(r, { status: 404, code: 'NOT_FOUND' });
  assert.match(r.json.error, /run 999 not found/);
  assert.equal(r.json.hint, 'browse ids via /api/localmaxxing');
});

test('#570 malformed POST /api/diff body → 400 problem+json (was 502, #747 class)', async () => {
  const req = {
    method: 'POST',
    query: {},
    headers: {},
    on() {}, // readJsonBody gates the stream path on req.on
    async *[Symbol.asyncIterator]() { yield Buffer.from('{nope'); }
  };
  const r = await call(diffHandler, req);
  assertProblem(r, { status: 400, code: 'INVALID_PARAMS' });
  assert.match(r.json.detail, /not valid JSON/);
});

test('#570 whatif invalid constraint set → problem+json with legacy error', async () => {
  const r = await call(diffHandler, { method: 'GET', query: { mode: 'whatif', a: '{nope', b: '{}' }, headers: {} });
  assertProblem(r, { status: 400, code: 'INVALID_PARAMS' });
  assert.equal(r.json.error, 'invalid constraint set');
});

test('#570 GET /api/sizing missing model → problem+json INVALID_PARAMS with legacy example', async () => {
  const r = await call(sizingHandler, { method: 'GET', query: {}, headers: {} });
  assertProblem(r, { status: 400, code: 'INVALID_PARAMS' });
  assert.match(r.json.error, /[Mm]issing required 'model'/);
  assert.ok(r.json.example.includes('/api/sizing?model='));
});

test('#570 GET /api/sizing no matching runs → problem+json NOT_FOUND with legacy workload echo', async () => {
  const r = await call(sizingHandler, { method: 'GET', query: { model: 'nonexistent-model-xyz' }, headers: {} });
  assertProblem(r, { status: 404, code: 'NOT_FOUND' });
  assert.match(r.json.error, /No comparable benchmark runs/);
  assert.deepEqual(r.json.workload.model, 'nonexistent-model-xyz');
});

test('#570 POST /api/localmaxxing validation failure → problem+json with errors[] preserved', async () => {
  const r = await call(localmaxxingHandler, { method: 'POST', query: {}, headers: {}, body: {} });
  assertProblem(r, { status: 400, code: 'INVALID_PARAMS' });
  assert.equal(r.json.error, 'validation_failed');
  assert.ok(Array.isArray(r.json.errors) && r.json.errors.length > 0, 'legacy errors[] must be preserved');
  for (const e of r.json.errors) {
    assert.ok('field' in e && 'code' in e && 'message' in e);
  }
});
