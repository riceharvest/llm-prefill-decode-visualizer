import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './_handlers/og.js';
import { rateLimit, RATE_LIMIT, _resetRateLimits } from './_ratelimit.js';

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 0,
    body: null,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    hasHeader(k) { return k.toLowerCase() in headers; },
    end(chunk) { this.body = chunk ?? null; }
  };
}

const req = (over = {}) => ({
  method: 'GET',
  url: '/api/og?preset=rtx4090_exl2',
  headers: { 'x-forwarded-for': '203.0.113.77' },
  ...over
});

test('exhausted budget -> /api/og returns 429 with Retry-After and X-RateLimit headers (#921)', async () => {
  _resetRateLimits();
  // Burn the whole fixed window for this client key via the shared limiter.
  for (let i = 0; i < RATE_LIMIT; i++) rateLimit('203.0.113.77');

  const res = mockRes();
  await handler(req(), res);

  assert.equal(res.statusCode, 429, 'unthrottled render farm: og must enforce the limiter');
  assert.equal(res.headers['retry-after'] !== undefined, true);
  assert.equal(res.headers['x-ratelimit-limit'], String(RATE_LIMIT));
  assert.equal(res.headers['x-ratelimit-remaining'], '0');
  assert.equal(res.headers['cache-control'], 'no-store', '429 must never be CDN-cacheable');
  const body = JSON.parse(res.body);
  assert.match(body.error, /Rate limit exceeded/);
});

test('within budget -> OPTIONS request is stamped with X-RateLimit headers (limiter wired before dispatch)', async () => {
  _resetRateLimits();
  const res = mockRes();
  await handler(req({ method: 'OPTIONS' }), res);

  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['x-ratelimit-limit'], String(RATE_LIMIT));
  assert.equal(res.headers['x-ratelimit-remaining'], String(RATE_LIMIT - 1));
});
