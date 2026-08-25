// GET /api/compute cacheability (#579): successful GET responses are pure
// deterministic math and now ship a Cache-Control max-age like their siblings
// (agent/compute.json, calc replay, presets). POST batch responses and error
// problem+json stay uncacheable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _resetRateLimits } from './_ratelimit.js';
import handler from './_handlers/compute.js';

function mockRes() {
  const headers = new Map();
  let statusCode = 200;
  const chunks = [];
  return {
    get body() { return chunks.join(''); },
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    status(v) { statusCode = v; return this; },
    setHeader(k, v) { headers.set(String(k).toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    end(body) { if (body != null) chunks.push(String(body)); }
  };
}

test('successful GET /api/compute ships Cache-Control public max-age=600 (#579)', () => {
  _resetRateLimits();
  const res = mockRes();
  handler({ method: 'GET', query: { model: 'singleTurn', promptTokens: '4096' }, headers: { 'x-forwarded-for': 'cache-get-test' }, url: '/api/compute' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('Cache-Control'), 'public, max-age=600');
});

test('POST (batch) responses stay uncacheable', () => {
  _resetRateLimits();
  const res = mockRes();
  handler({ method: 'POST', query: {}, body: { batch: [{ model: 'singleTurn' }] }, headers: { 'x-forwarded-for': 'cache-post-test' }, url: '/api/compute' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('Cache-Control'), undefined);
});

test('error responses stay uncacheable', () => {
  _resetRateLimits();
  const res = mockRes();
  handler({ method: 'GET', query: { model: 'nope-does-not-exist' }, headers: { 'x-forwarded-for': 'cache-err-test' }, url: '/api/compute' }, res);
  assert.equal(res.statusCode, 400);
  const cc = res.getHeader('Cache-Control');
  assert.ok(!cc || !/max-age=[1-9]/.test(String(cc)), `no positive caching on errors (got ${cc})`);
});

test('OPTIONS preflight stays uncacheable', () => {
  _resetRateLimits();
  const res = mockRes();
  handler({ method: 'OPTIONS', query: {}, headers: {}, url: '/api/compute' }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.getHeader('Cache-Control'), undefined);
});
