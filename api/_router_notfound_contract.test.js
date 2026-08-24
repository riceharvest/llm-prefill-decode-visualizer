// Contract tests for the catch-all router's unknown-path 404 (#514, #515).
//
// #514: unknown /api/* paths must answer with the documented problem+json
// error contract (stable NOT_FOUND code) and echo the FULL requested path —
// the old body stripped the /api prefix ("path": "/nope123" for a request to
// /api/nope123), breaking log correlation.
//
// #515: 404 responses must carry the same X-RateLimit-* quota signal as every
// other endpoint, and those headers must be CORS-exposed to browser agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/[...path].js';
import { RATE_LIMIT } from '../api/_ratelimit.js';

async function callHandler(url, headers = {}) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(this.headers, String(k).toLowerCase()); },
    end(body) {
      captured.status = this.statusCode;
      captured.body = body;
    }
  };
  await handler({ url, query: {}, headers }, res);
  return { status: captured.status, headers: res.headers, body: captured.body };
}

test('unknown /api/* path → problem+json with stable NOT_FOUND code (#514)', async () => {
  const { status, headers, body } = await callHandler('/api/nope123');
  assert.equal(status, 404);
  assert.match(headers['Content-Type'], /application\/problem\+json/);
  const json = JSON.parse(body);
  assert.equal(json.code, 'NOT_FOUND');
  assert.equal(json.status, 404);
  assert.ok(json.title);
  assert.match(json.type, /not-found$/);
});

test('404 echoes the FULL requested path incl. the /api prefix (#514)', async () => {
  const { body } = await callHandler('/api/nope123');
  const json = JSON.parse(body);
  assert.equal(json.instance, '/api/nope123');
  // Legacy member kept, but now with the correct (unstripped) value.
  assert.equal(json.path, '/api/nope123');
  assert.equal(json.error, 'Not found'); // back-compat for existing clients
});

test('query string is not part of the echoed instance/path', async () => {
  const { body } = await callHandler('/api/also-nope?x=1');
  const json = JSON.parse(body);
  assert.equal(json.instance, '/api/also-nope');
  assert.equal(json.path, '/api/also-nope');
});

test('404 responses carry X-RateLimit-* headers like every other endpoint (#515)', async () => {
  const { headers } = await callHandler('/api/nope123');
  for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) {
    assert.ok(headers[h] !== undefined, `expected ${h} on the 404 response`);
  }
  assert.equal(Number(headers['X-RateLimit-Limit']), RATE_LIMIT);
});

test('X-RateLimit-* + Retry-After are CORS-exposed to browser agents (#515)', async () => {
  const { headers } = await callHandler('/api/nope123');
  const expose = String(headers['Access-Control-Expose-Headers'] || '')
    .split(',').map(s => s.trim());
  for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After']) {
    assert.ok(expose.includes(h), `expected ${h} in Access-Control-Expose-Headers, got: ${expose.join(', ')}`);
  }
});
