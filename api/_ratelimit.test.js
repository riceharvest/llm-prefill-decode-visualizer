import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rateLimit,
  enforceRateLimit,
  clientKey,
  _resetRateLimits,
  RATE_LIMIT,
  RATE_WINDOW_MS
} from './_ratelimit.js';

function mockReq(ip = '1.2.3.4') {
  return { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` }, socket: { remoteAddress: ip } };
}

function mockRes() {
  const headers = {};
  const mock = {
    statusCode: 200,
    headers,
    body: null,
    setHeader(k, v) { headers[k] = v; },
    end(b) { if (b !== undefined) mock.body = b; }
  };
  return mock;
}

test('allows requests under the limit and decrements Remaining', () => {
  _resetRateLimits();
  const t0 = 1_000_000;
  const first = rateLimit('a', t0);
  assert.equal(first.allowed, true);
  assert.equal(first.limit, RATE_LIMIT);
  assert.equal(first.remaining, RATE_LIMIT - 1);

  const second = rateLimit('a', t0 + 100);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, RATE_LIMIT - 2);
});

test('blocks once the window budget is exhausted', () => {
  _resetRateLimits();
  const t0 = 2_000_000;
  let last;
  for (let i = 0; i < RATE_LIMIT; i++) last = rateLimit('b', t0);
  assert.equal(last.allowed, true);
  assert.equal(last.remaining, 0);

  const over = rateLimit('b', t0 + 1);
  assert.equal(over.allowed, false);
  // Over-limit probes do not consume further budget
  assert.equal(over.remaining, 0);
  assert.ok(over.retryAfterSec >= 1 && over.retryAfterSec <= RATE_WINDOW_MS / 1000);
});

test('window expiry resets the bucket', () => {
  _resetRateLimits();
  const t0 = 3_000_000;
  for (let i = 0; i < RATE_LIMIT; i++) rateLimit('c', t0);
  assert.equal(rateLimit('c', t0 + 1000).allowed, false);

  const fresh = rateLimit('c', t0 + RATE_WINDOW_MS);
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.remaining, RATE_LIMIT - 1);
});

test('reset is reported as future epoch seconds inside the current window', () => {
  _resetRateLimits();
  const t0 = 4_000_000;
  const info = rateLimit('d', t0);
  assert.equal(info.resetEpochSec, Math.ceil((t0 + RATE_WINDOW_MS) / 1000));
  assert.ok(info.resetEpochSec > Math.ceil(t0 / 1000));
});

test('buckets are independent per client key', () => {
  _resetRateLimits();
  const t0 = 5_000_000;
  for (let i = 0; i < RATE_LIMIT; i++) rateLimit('e', t0);
  assert.equal(rateLimit('e', t0).allowed, false);
  assert.equal(rateLimit('f', t0).allowed, true);
});

test('clientKey prefers the first X-Forwarded-For hop', () => {
  assert.equal(clientKey(mockReq('9.9.9.9')), '9.9.9.9');
  assert.equal(clientKey({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
  assert.equal(clientKey({ headers: {} }), 'unknown');
});

test('enforceRateLimit stamps headers and passes under the limit', () => {
  _resetRateLimits();
  const res = mockRes();
  const ok = enforceRateLimit(mockReq(), res);
  assert.equal(ok, true);
  assert.equal(res.headers['X-RateLimit-Limit'], String(RATE_LIMIT));
  assert.match(res.headers['X-RateLimit-Remaining'], /^\d+$/);
  assert.match(res.headers['X-RateLimit-Reset'], /^\d+$/);
  assert.equal(res.statusCode, 200); // untouched — handler continues
});

test('enforceRateLimit writes a full 429 with Retry-After when exhausted', () => {
  _resetRateLimits();
  const t0 = Date.now();
  const req = mockReq('7.7.7.7');
  for (let i = 0; i < RATE_LIMIT; i++) rateLimit('7.7.7.7', t0);

  const res = mockRes();
  const ok = enforceRateLimit(req, res);
  assert.equal(ok, false);
  assert.equal(res.statusCode, 429);
  assert.match(res.headers['Retry-After'], /^[1-9]\d*$/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  const parsed = JSON.parse(res.body);
  assert.match(parsed.error, /Rate limit exceeded/);
  assert.equal(parsed.limit, RATE_LIMIT);
  assert.equal(parsed.retryAfterSeconds, Number(res.headers['Retry-After']));
});

test('exhausted 429 body carries the documented RATE_LIMITED problem members', () => {
  _resetRateLimits();
  const t0 = Date.now();
  const req = mockReq('8.8.8.8');
  for (let i = 0; i < RATE_LIMIT; i++) rateLimit('8.8.8.8', t0);

  const res = mockRes();
  const ok = enforceRateLimit(req, res);
  assert.equal(ok, false);
  assert.equal(res.statusCode, 429);
  const parsed = JSON.parse(res.body);
  // Documented contract (spec x-error-codes + watch/parse-constraints 429s)
  assert.equal(parsed.code, 'RATE_LIMITED');
  assert.equal(parsed.title, 'Rate limited');
  assert.equal(parsed.status, 429);
  assert.match(parsed.type, /\/problems\/rate-limited$/);
  assert.equal(parsed.detail, parsed.error); // legacy field kept as alias
  // Legacy flat fields remain intact for existing clients
  assert.equal(parsed.limit, RATE_LIMIT);
  assert.equal(parsed.remaining, 0);
  assert.equal(parsed.reset, Number(res.headers['X-RateLimit-Reset']));
  assert.match(parsed.note, /llms\.txt/);
});