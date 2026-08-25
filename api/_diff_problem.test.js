// Regression tests for #545 (/api/diff must speak RFC 9457 problem+json with
// a stable `code`, like every other endpoint promises) and part of #539
// (uniform error shapes across endpoints).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import handler from './_handlers/diff.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(this.headers, k); },
    end(payload) { if (payload !== undefined) this.body += payload; }
  };
}

// Case-insensitive header lookup for mock res objects.
function header(res, name) {
  const key = Object.keys(res.headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? res.headers[key] : undefined;
}

async function call(url, query = {}) {
  const res = mockRes();
  const parsed = Object.fromEntries(new URL(url, 'http://x').searchParams);
  await handler({ method: 'GET', url, headers: {}, query: { ...parsed, ...query } }, res);
  return res;
}

test('#545: missing runA/runB -> 400 application/problem+json with stable code', async () => {
  const res = await call('/api/diff');
  assert.equal(res.statusCode, 400);
  assert.match(header(res, 'content-type'), /application\/problem\+json/);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_PARAMS');
  assert.equal(body.status, 400);
  assert.equal(body.title, 'Invalid parameters');
  assert.match(body.type, /\/problems\/invalid-params$/);
  assert.match(body.detail, /runA/);
  // Guidance is preserved as extra members, not dropped.
  assert.equal(body.example, '/api/diff?runA=1234&runB=5678');
});

test('#545: identical run ids -> 400 problem+json INVALID_PARAMS', async () => {
  const res = await call('/api/diff?runA=x&runB=x');
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_PARAMS');
  assert.match(body.detail, /must be different/);
});

test('#545: what-if mode missing constraint sets -> 400 problem+json INVALID_PARAMS', async () => {
  const res = await call('/api/diff?mode=whatif');
  assert.equal(res.statusCode, 400);
  assert.match(header(res, 'content-type'), /application\/problem\+json/);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_PARAMS');
  assert.ok(body.example, 'what-if example preserved');
});

test('#545: invalid what-if constraint JSON -> 400 problem+json INVALID_PARAMS', async () => {
  const res = await call('/api/diff?mode=whatif&a={not-json&b={also-not');
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_PARAMS');
  assert.match(body.detail, /invalid constraint set/);
});
