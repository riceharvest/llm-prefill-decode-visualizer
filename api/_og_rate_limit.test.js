// Issue #921 — /api/og PNG renders are metered like every other endpoint.
// Pre-fill the limiter bucket for a test IP, then hit the handler: expect 429
// + Retry-After + X-RateLimit headers instead of a free satori render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import og, { parseOgParams } from '../api/_handlers/og.js';
import { rateLimit, _resetRateLimits, RATE_LIMIT } from '../api/_ratelimit.js';

const TEST_IP = '203.0.113.77';

function mockReq({ method = 'GET', url = '/api/og?preset=rtx4090_exl2' } = {}) {
  return {
    method,
    url,
    headers: { 'x-forwarded-for': TEST_IP },
    query: Object.fromEntries(new URL(url, 'http://x').searchParams)
  };
}

function mockRes() {
  const headers = {};
  let body = '';
  return {
    headers,
    statusCode: 0,
    body: () => body,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in headers; },
    removeHeader(k) { delete headers[String(k).toLowerCase()]; },
    end(arg) { if (arg != null) body += arg; return this; }
  };
}

test('parseOgParams contract unchanged (rate limiting is additive)', () => {
  const cfg = parseOgParams(new URLSearchParams('preset=rtx4090_exl2&prefill=3800'));
  assert.equal(cfg.preset.id, 'rtx4090_exl2');
  assert.equal(cfg.prefill, 3800);
});

test('exhausted bucket → 429 with Retry-After and no PNG render', async () => {
  _resetRateLimits();
  for (let i = 0; i < RATE_LIMIT; i++) rateLimit(TEST_IP);
  const res = mockRes();
  await og(mockReq(), res);
  assert.equal(res.statusCode, 429, `expected 429, got ${res.statusCode}`);
  assert.ok(res.getHeader('retry-after'), 'Retry-After present');
  assert.equal(res.getHeader('x-ratelimit-remaining'), '0');
  assert.doesNotMatch(res.body(), /PNG/, 'no image bytes on the 429 path');
});

test('within budget → still renders (200 image/png) with X-RateLimit headers', async () => {
  _resetRateLimits();
  const res = mockRes();
  await og(mockReq(), res);
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.match(String(res.getHeader('content-type') || ''), /image\/png/);
  assert.ok(res.getHeader('x-ratelimit-limit'), 'X-RateLimit-Limit stamped');
});

test('OPTIONS preflight stays free (does not consume the budget)', async () => {
  _resetRateLimits();
  const before = rateLimit(TEST_IP).remaining;
  const res = mockRes();
  await og(mockReq({ method: 'OPTIONS', url: '/api/og' }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(rateLimit(TEST_IP).remaining, before - 1, 'only our probe consumed');
});
