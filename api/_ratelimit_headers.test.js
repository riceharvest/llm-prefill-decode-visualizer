// Regression tests for the "every /api/* JSON response carries X-RateLimit-*"
// contract (issue #553): sendJson() must stamp the header trio on every
// response — both when the handler ran enforceRateLimit() (real per-client
// window numbers) and when the request path bypassed it (documented budget,
// no bucket consumption).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendJson } from './_schema.js';
import {
  enforceRateLimit,
  _resetRateLimits,
  RATE_LIMIT
} from './_ratelimit.js';

function mockReq(ip = '9.9.9.9') {
  return { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` }, socket: { remoteAddress: ip } };
}

function mockRes() {
  const headers = {};
  const mock = {
    statusCode: 200,
    headers,
    body: null,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
    hasHeader(k) { return k in headers; },
    end(b) { if (b !== undefined) mock.body = b; }
  };
  return mock;
}

test('sendJson mirrors enforceRateLimit window numbers in the headers', () => {
  _resetRateLimits();
  const res = mockRes();
  assert.equal(enforceRateLimit(mockReq(), res), true);
  sendJson(res, { ok: true });

  assert.equal(res.headers['X-RateLimit-Limit'], String(RATE_LIMIT));
  assert.equal(res.headers['X-RateLimit-Remaining'], String(RATE_LIMIT - 1));
  assert.ok(/^\d+$/.test(res.headers['X-RateLimit-Reset']), 'reset is epoch seconds');
});

test('sendJson stamps fallback X-RateLimit-* when enforcement never ran', () => {
  _resetRateLimits();
  const res = mockRes();
  sendJson(res, { ok: true }); // e.g. /api/health, /api/version, router 404

  for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) {
    assert.ok(h in res.headers, `must stamp ${h} even without enforceRateLimit`);
  }
  assert.equal(res.headers['X-RateLimit-Limit'], String(RATE_LIMIT));
  // No bucket was consumed by this response path: full documented budget.
  assert.equal(res.headers['X-RateLimit-Remaining'], String(RATE_LIMIT));
  const reset = Number(res.headers['X-RateLimit-Reset']);
  assert.ok(Number.isInteger(reset) && reset > Math.floor(Date.now() / 1000), 'reset in the future');
});

test('fallback stamping does not consume from any client bucket', () => {
  _resetRateLimits();
  const other = mockRes();
  sendJson(other, { ok: true }); // unbudgeted path

  // A real client's first metered request still sees a fresh window.
  const res = mockRes();
  enforceRateLimit(mockReq('8.8.8.8'), res);
  assert.equal(res.headers['X-RateLimit-Remaining'], String(RATE_LIMIT - 1));
});

test('sendJson never overwrites headers a handler already stamped', () => {
  _resetRateLimits();
  const res = mockRes();
  enforceRateLimit(mockReq('7.7.7.7'), res);
  enforceRateLimit(mockReq('7.7.7.7'), res); // same res twice → window consumed twice
  sendJson(res, { ok: true });
  // Headers still reflect what enforceRateLimit stamped (RATE_LIMIT - 2), not the fallback.
  assert.equal(res.headers['X-RateLimit-Remaining'], String(RATE_LIMIT - 2));
});
