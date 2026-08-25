// Contract tests for /api/vram error responses (#514) and rate-limit header
// coverage on the endpoint (#515).
//
// #514: validation and upstream failures must follow the documented RFC 9457
// problem+json contract (type/title/status/code with a stable code) instead of
// the old ad-hoc {error, params} shape. Legacy flat members stay as extras.
//
// #515: /api/vram previously short-circuited before any rate limiter, so even
// successes and 400s carried no X-RateLimit-* headers at all.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/_handlers/vram.js';
import { RATE_LIMIT } from '../api/_ratelimit.js';

function call({ method = 'GET', query = {}, body, url = '/api/vram' } = {}) {
  const req = { method, query, body, url };
  const res = {
    statusCode: 200,
    headers: {},
    bodyText: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(this.headers, String(k).toLowerCase()); },
    status(c) { this.statusCode = c; return this; },
    end(p) { if (p !== undefined) this.bodyText = p; }
  };
  return handler(req, res).then(() => ({
    status: res.statusCode,
    headers: res.headers,
    contentType: res.headers['Content-Type'],
    json: JSON.parse(res.bodyText)
  }));
}

beforeEach(() => {
  // Offline tier-1 resolution: builtin-table hits never touch the network.
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
});

test('missing hfId → documented problem+json shape with stable code INVALID_PARAMS (#514)', async () => {
  const r = await call({ query: {} });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/problem\+json/);
  assert.equal(r.json.code, 'INVALID_PARAMS');
  assert.equal(r.json.status, 400);
  assert.ok(r.json.title);
  assert.match(r.json.type, /invalid-params$/);
  assert.match(r.json.detail, /hfId/);
  assert.equal(r.json.instance, '/api/vram');
});

test('legacy guidance members survive alongside the problem body (back-compat)', async () => {
  const r = await call({ query: {} });
  assert.match(r.json.error, /hfId/);
  assert.ok(Array.isArray(r.json.params) && r.json.params.some(p => /hfId/.test(p)));
  assert.ok(Array.isArray(r.json.examples));
});

test('successes carry X-RateLimit-* headers too (#515)', async () => {
  const r = await call({
    query: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', context: '8192' },
    url: '/api/vram?hfId=meta-llama%2FLlama-3.1-8B-Instruct'
  });
  assert.equal(r.status, 200);
  for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) {
    assert.ok(r.headers[h] !== undefined, `expected ${h} on a 200 response`);
  }
  assert.equal(Number(r.headers['X-RateLimit-Limit']), RATE_LIMIT);
});

test('validation failures carry X-RateLimit-* headers exactly when agents need them (#515)', async () => {
  const r = await call({ query: {} });
  assert.equal(r.status, 400);
  for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) {
    assert.ok(r.headers[h] !== undefined, `expected ${h} on a 400 response`);
  }
});

test('unknown repo (upstream 404) → problem+json NOT_FOUND passthrough (#514)', async () => {
  globalThis.fetch = async (url) => ({
    ok: false,
    status: 404,
    json: async () => ({})
  });
  const r = await call({ query: { hfId: 'org/does-not-exist-xyz' } });
  assert.equal(r.status, 404);
  assert.match(r.contentType, /application\/problem\+json/);
  assert.equal(r.json.code, 'NOT_FOUND');
  assert.equal(r.json.status, 404);
  // Legacy flat member kept so existing clients keep working.
  assert.ok(typeof r.json.error === 'string');
});
