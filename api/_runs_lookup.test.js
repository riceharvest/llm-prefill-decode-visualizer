// Regression tests for the single-run lookup cluster:
//   #767 — /api/runs must honor ?runId=/?id= instead of silently returning
//           the whole dump; empty values are a loud 400.
//   #766 — GET /api/runs/{runId} resolves ONE run without downloading the
//           full dump; unknown ids return problem+json 404 (NOT_FOUND).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { runLookup } from './_handlers/runs.js';
import { invalidateCache } from './_localmaxxing.js';
import { _resetRateLimits } from './_ratelimit.js';

const UPSTREAM_ROWS = [
  {
    id: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    batchSize: 1,
    engineFlags: { concurrency: 1 },
    tokSPrefill: 1000.4,
    tokSOut: 50.6,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    model: { hfId: 'org/model-a', displayName: 'Model A', params: 8 },
    hardwareGroupKey: 'rtx-4090',
    hardwareGroupLabel: 'RTX 4090',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b1' }
  },
  {
    id: 2,
    batchSize: 8, // batched → non-comparable
    engineFlags: { numParallel: 8 },
    tokSPrefill: 4000,
    tokSOut: 900,
    model: { hfId: 'org/model-b', displayName: 'Model B', params: 70 },
    hardwareGroupKey: 'h100',
    hardwareGroupLabel: 'H100',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'H100', gpuCount: 1 },
    engine: { engineName: 'vLLM' }
  }
];

let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  invalidateCache();
  _resetRateLimits();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [...UPSTREAM_ROWS] })
  });
});

function restore() {
  globalThis.fetch = realFetch;
}

function mockReq(url, query = {}) {
  return { url, method: 'GET', query, headers: {}, socket: { remoteAddress: '10.0.0.1' } };
}

function mockRes() {
  const chunks = [];
  return {
    statusCode: null,
    headers: {},
    bodyText: '',
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    write(c) { chunks.push(String(c)); },
    end(c) { if (c != null) chunks.push(String(c)); this.bodyText = chunks.join(''); this.ended = true; }
  };
}

test('#767: ?runId= filters the dump to that single run', async () => {
  try {
    const res = mockRes();
    await handler(mockReq('/api/runs', { runId: '1' }), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.rowCount, 1);
    assert.equal(body.totalRunCount, 2); // index size is never filtered
    assert.equal(body.runs.length, 1);
    assert.equal(String(body.runs[0].runId), '1');
    assert.equal(body.runIdFilter, '1');
  } finally { restore(); }
});

test('#767: ?id= alias filters identically', async () => {
  try {
    const res = mockRes();
    await handler(mockReq('/api/runs', { id: '2' }), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.rowCount, 1);
    assert.equal(String(body.runs[0].runId), '2');
  } finally { restore(); }
});

test('#767: ?comparable=true composes with ?runId=', async () => {
  try {
    // Run 2 is non-comparable — filtering on it through the comparable=true
    // subset yields zero rows rather than silently ignoring one of the two.
    const res = mockRes();
    await handler(mockReq('/api/runs', { comparable: 'true', runId: '2' }), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.rowCount, 0);
  } finally { restore(); }
});

test('#767: unknown ?runId= returns an explicit empty result, not the full dump', async () => {
  try {
    const res = mockRes();
    await handler(mockReq('/api/runs', { runId: 'nope' }), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.rowCount, 0);
    assert.deepEqual(body.runs, []);
    assert.equal(body.runIdFilter, 'nope');
  } finally { restore(); }
});

test('#767: empty ?runId= is a loud 400 INVALID_PARAMS problem response', async () => {
  try {
    const res = mockRes();
    await handler(mockReq('/api/runs', { runId: '' }), res);
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.code, 'INVALID_PARAMS');
  } finally { restore(); }
});

test('#766: GET /api/runs/{runId} returns exactly one run without the full dump', async () => {
  try {
    const res = mockRes();
    await runLookup(mockReq('/api/runs/1', { id: '1' }), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.schemaVersion, 1);
    assert.ok(body.generatedAt);
    assert.equal(Object.keys(body).includes('runs'), false);
    assert.equal(String(body.run.runId), '1');
    assert.equal(body.run.modelFamily.length > 0, true);
  } finally { restore(); }
});

test('#766: unknown run id returns problem+json 404 NOT_FOUND', async () => {
  try {
    const res = mockRes();
    await runLookup(mockReq('/api/runs/deadbeef', { id: 'deadbeef' }), res);
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(body.status, 404);
  } finally { restore(); }
});

test('#766: missing path id is a 400 INVALID_PARAMS, not a silent full dump', async () => {
  try {
    const res = mockRes();
    await runLookup(mockReq('/api/runs/', {}), res);
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.code, 'INVALID_PARAMS');
  } finally { restore(); }
});

test('#766: non-GET methods are rejected with 405 METHOD_NOT_ALLOWED', async () => {
  try {
    const req = mockReq('/api/runs/1', { id: '1' });
    req.method = 'DELETE';
    const res = mockRes();
    await runLookup(req, res);
    assert.equal(res.statusCode, 405);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.code, 'METHOD_NOT_ALLOWED');
  } finally { restore(); }
});
