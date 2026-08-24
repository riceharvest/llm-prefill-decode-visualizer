import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from './_handlers/runs.js';
import { invalidateCache } from './_localmaxxing.js';
import { _resetRateLimits } from './_ratelimit.js';

// Mock upstream: one comparable + one batched/non-comparable run.
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

function mockReq(query = {}) {
  return { url: '/api/runs', method: 'GET', query, headers: {}, socket: { remoteAddress: '10.0.0.1' } };
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

test('GET /api/runs returns the full index as JSON with envelope metadata', async () => {
  try {
    const res = mockRes();
    await handler(mockReq({}), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.schema_version, '1');
    assert.equal(body.rowCount, 2);
    assert.equal(body.totalRunCount, 2);
    assert.equal(body.comparableCount, 1);
    assert.equal(body.comparableFilter, 'all');
    assert.equal(body.runs.length, 2);
    const tags = body.runs.map(r => r.comparable).sort();
    assert.deepEqual(tags, [false, true]);
    // comparable row keeps rounded speeds
    const comp = body.runs.find(r => r.comparable);
    assert.equal(comp.prefillTokPerSec, 1000);
    assert.equal(comp.decodeTokPerSec, 51);
    assert.ok(res.headers['x-schema-version']);
  } finally { restore(); }
});

test('?comparable=true|false subsets rows and reports totalRunCount', async () => {
  try {
    const yes = mockRes();
    await handler(mockReq({ comparable: 'true' }), yes);
    const yesBody = JSON.parse(yes.bodyText);
    assert.equal(yesBody.rowCount, 1);
    assert.equal(yesBody.totalRunCount, 2);
    assert.ok(yesBody.runs.every(r => r.comparable === true));

    const no = mockRes();
    await handler(mockReq({ comparable: 'false' }), no);
    const noBody = JSON.parse(no.bodyText);
    assert.equal(noBody.rowCount, 1);
    assert.ok(noBody.runs.every(r => r.comparable === false));
  } finally { restore(); }
});

test('?format=csv serves RFC 4180 CSV with #-preamble as an attachment', async () => {
  try {
    const res = mockRes();
    await handler(mockReq({ format: 'csv' }), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], /attachment; filename="localmaxxing-all-runs-v1-\d{8}\.csv"/);
    const lines = res.bodyText.split('\r\n').filter(Boolean);
    assert.ok(lines[0].startsWith('# dataset:'));
    assert.equal(lines.filter(l => !l.startsWith('#'))[0].split(',').length >= 20, true);
    assert.equal(lines.filter(l => !l.startsWith('#')).length, 3); // header + 2 rows
  } finally { restore(); }
});

test('invalid format / comparable values return 400 problem+json', async () => {
  try {
    for (const query of [{ format: 'xml' }, { comparable: 'maybe' }]) {
      const res = mockRes();
      await handler(mockReq(query), res);
      assert.equal(res.statusCode, 400);
      assert.match(res.headers['content-type'], /problem\+json/);
      const problem = JSON.parse(res.bodyText);
      assert.equal(problem.code, 'INVALID_PARAMS');
    }
  } finally { restore(); }
});

test('OPTIONS preflight returns 204 with CORS headers', async () => {
  try {
    const res = mockRes();
    await handler({ ...mockReq({}), method: 'OPTIONS' }, res);
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.match(res.headers['access-control-allow-methods'], /GET/);
  } finally { restore(); }
});

test('non-GET methods return a 405 problem+json with an Allow header', async () => {
  try {
    for (const method of ['POST', 'DELETE']) {
      const res = mockRes();
      await handler({ ...mockReq({}), method }, res);
      assert.equal(res.statusCode, 405);
      assert.match(res.headers['content-type'], /problem\+json/);
      assert.equal(res.headers.allow, 'GET, HEAD, OPTIONS');
      const problem = JSON.parse(res.bodyText);
      assert.equal(problem.code, 'METHOD_NOT_ALLOWED');
    }
  } finally { restore(); }
});

test('upstream failure surfaces a 502 problem response', async () => {
  try {
    invalidateCache();
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    const res = mockRes();
    await handler(mockReq({}), res);
    assert.equal(res.statusCode, 502);
    const problem = JSON.parse(res.bodyText);
    assert.equal(problem.code, 'UPSTREAM_UNAVAILABLE');
  } finally { restore(); }
});
