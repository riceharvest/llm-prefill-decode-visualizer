// Tests for the app-level request body size cap (#926).
//
// Contract: bodies over MAX_BODY_BYTES (4 MiB) are rejected with the standard
// RFC 9457 problem+json 413 (code PAYLOAD_TOO_LARGE) — never the platform
// edge's bare text/plain 413. Stream readers (/api/diff, /api/mcp) bound
// memory by stopping consumption at the cap; object-body handlers
// (/api/compute, /api/watch, /api/localmaxxing) pre-check Content-Length.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_BODY_BYTES,
  bodyLimitExceeded,
  rejectOversizedBody,
  readBodyBuffer
} from './_body_limit.js';
import { ApiError } from './_errors.js';
import { _resetRateLimits } from './_ratelimit.js';
import diffHandler from './_handlers/diff.js';
import mcpHandler from './mcp.js';
import computeHandler from './_handlers/compute.js';

function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    body: undefined,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

/** Async-iterable request mock delivering `chunks` (POST, no platform body). */
function streamReq(chunks, { headers = {} } = {}) {
  return {
    method: 'POST',
    headers,
    url: '/api/diff',
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    }
  };
}

test('MAX_BODY_BYTES is 4 MiB — comfortably below the ~4.5 MB platform edge', () => {
  assert.equal(MAX_BODY_BYTES, 4 * 1024 * 1024);
});

test('bodyLimitExceeded tolerates missing/invalid Content-Length', () => {
  assert.equal(bodyLimitExceeded({ headers: {} }), false);
  assert.equal(bodyLimitExceeded({ headers: { 'content-length': 'abc' } }), false);
  assert.equal(bodyLimitExceeded({}), false);
});

test('bodyLimitExceeded flags declared sizes over the cap only', () => {
  assert.equal(bodyLimitExceeded({ headers: { 'content-length': String(MAX_BODY_BYTES) } }), false);
  assert.equal(bodyLimitExceeded({ headers: { 'content-length': String(MAX_BODY_BYTES + 1) } }), true);
});

test('rejectOversizedBody sends problem+json 413 and reports it sent', () => {
  const res = mockRes();
  const req = { headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, url: '/api/compute' };
  assert.equal(rejectOversizedBody(req, res), true);
  assert.equal(res.statusCode, 413);
  assert.equal(res.headers['content-type'], 'application/problem+json');
  const problem = JSON.parse(res.body);
  assert.equal(problem.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(problem.status, 413);
  assert.equal(problem.type.endsWith('/problems/payload-too-large'), true);
});

test('rejectOversizedBody passes normal-sized requests through untouched', () => {
  const res = mockRes();
  assert.equal(rejectOversizedBody({ headers: { 'content-length': '1024' } }, res), false);
  assert.equal(res.body, undefined);
});

test('readBodyBuffer accepts bodies under the cap', async () => {
  const buf = await readBodyBuffer(streamReq([Buffer.from('{"a":'), Buffer.from('1}')]));
  assert.deepEqual(JSON.parse(buf.toString('utf8')), { a: 1 });
});

test('readBodyBuffer throws ApiError PAYLOAD_TOO_LARGE past the cap', async () => {
  const half = Buffer.alloc(MAX_BODY_BYTES / 2 + 10, 0x61);
  const req = streamReq([half, half]);
  await assert.rejects(
    () => readBodyBuffer(req),
    err => err instanceof ApiError && err.code === 'PAYLOAD_TOO_LARGE' && err.status === 413
  );
});

test('POST /api/diff with an oversized stream returns problem+json 413', async () => {
  const big = Buffer.alloc(MAX_BODY_BYTES + 1024, 0x62);
  const res = mockRes();
  await diffHandler(streamReq([big]), res);
  assert.equal(res.statusCode, 413);
  assert.equal(res.headers['content-type'], 'application/problem+json');
  const problem = JSON.parse(res.body);
  assert.equal(problem.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(problem.status, 413);
});

test('POST /api/diff still parses normal JSON bodies after the cap wiring', async () => {
  const res = mockRes();
  await diffHandler(
    streamReq([Buffer.from(JSON.stringify({ mode: 'whatif' }))]),
    res
  );
  // what-if mode without a/b constraints → the documented 400 shape, i.e. the
  // body was read and understood (not a size failure).
  assert.equal(res.statusCode, 400);
  assert.notEqual(res.headers['content-type'], 'application/problem+json');
});

test('POST /api/diff with oversized Content-Length fails fast before reading', async () => {
  const res = mockRes();
  await diffHandler(
    streamReq([], { headers: { 'content-length': String(MAX_BODY_BYTES + 5) } }),
    res
  );
  assert.equal(res.statusCode, 413);
  assert.equal(JSON.parse(res.body).code, 'PAYLOAD_TOO_LARGE');
});

test('POST /api/mcp with an oversized body returns problem+json 413', async () => {
  const big = Buffer.alloc(MAX_BODY_BYTES + 1024, 0x7b);
  const res = mockRes();
  await mcpHandler(streamReq([big], { url: '/api/mcp' }), res);
  assert.equal(res.statusCode, 413);
  assert.equal(res.headers['content-type'], 'application/problem+json');
  const problem = JSON.parse(res.body);
  assert.equal(problem.code, 'PAYLOAD_TOO_LARGE');
});

test('POST /api/mcp with oversized declared Content-Length returns 413', async () => {
  const res = mockRes();
  await mcpHandler(
    { method: 'POST', headers: { 'content-length': String(MAX_BODY_BYTES + 5) }, url: '/api/mcp' },
    res
  );
  assert.equal(res.statusCode, 413);
  assert.equal(JSON.parse(res.body).code, 'PAYLOAD_TOO_LARGE');
});

test('POST /api/mcp still answers normal messages after the cap wiring', async () => {
  const res = mockRes();
  await mcpHandler(
    streamReq([Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }))], { url: '/api/mcp' }),
    res
  );
  assert.equal(res.statusCode, 200);
  const rpc = JSON.parse(res.body);
  assert.equal(rpc.id, 7);
  assert.deepEqual(rpc.result, {});
});

test('POST /api/compute pre-checks Content-Length against the cap', async () => {
  _resetRateLimits();
  const res = mockRes();
  await computeHandler(
    { method: 'POST', headers: { 'content-length': String(MAX_BODY_BYTES + 5) }, query: {}, url: '/api/compute', socket: { remoteAddress: '9.9.9.9' } },
    res
  );
  assert.equal(res.statusCode, 413);
  assert.equal(res.headers['content-type'], 'application/problem+json');
  assert.equal(JSON.parse(res.body).code, 'PAYLOAD_TOO_LARGE');
});
