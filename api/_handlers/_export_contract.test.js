// #737 — /api/export contract: method guard (405 problem+json + Allow),
// CORS preflight, and rate-limit wiring. Success/error paths that hit the
// dataset are covered elsewhere; these checks run before any upstream fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './export.js';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    end(b) { this.ended = true; if (b) this.body = b.toString(); }
  };
}

test('POST /api/export is rejected with 405 problem+json + Allow (#737)', async () => {
  const res = mockRes();
  await handler({ method: 'POST', url: '/api/export', query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.match(String(res.headers['Content-Type']), /application\/problem\+json/);
  assert.equal(res.headers.Allow, 'GET, OPTIONS');
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'METHOD_NOT_ALLOWED');
  assert.equal(body.status, 405);
  assert.ok(body.title);
});

test('OPTIONS /api/export answers 204 with CORS preflight headers', async () => {
  const res = mockRes();
  await handler({ method: 'OPTIONS', url: '/api/export', query: {} }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.match(String(res.headers['Access-Control-Allow-Methods']), /GET/);
});

test('GET carries rate-limit headers (enforceRateLimit wired, #737)', async () => {
  // Upstream fetch may fail in a sandbox — either way the RATE-LIMIT headers
  // must be stamped before the dataset work, and failures must be
  // problem+json with a machine-readable code (never bare {error}).
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/export?format=json', query: { format: 'json' } }, res);
  assert.ok(res.headers['X-RateLimit-Limit'], 'missing X-RateLimit-Limit');
  if (res.statusCode !== 200) {
    assert.match(String(res.headers['Content-Type']), /application\/problem\+json/);
    const body = JSON.parse(res.body);
    assert.ok(body.code, 'error body missing machine-readable code');
    assert.equal(body.error, undefined, 'off-contract bare {error} body leaked');
  }
});
