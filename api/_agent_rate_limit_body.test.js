// Tests for machine-readable rate-limit info in agent-facing JSON response
// bodies (`rate_limit` object, mirroring the X-RateLimit-* headers).
//
// Contract (see AGENTS.md "Rate limits" and public/llms.txt):
//   - Every handler calls enforceRateLimit(req, res) FIRST.
//   - Every JSON body sent via sendJson() afterwards carries `rate_limit`:
//     { limit, remaining, reset, window_seconds, policy }.
//   - Bodies from handlers that skipped enforceRateLimit carry no field
//     (additive field, schema_version stays "1").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enforceRateLimit,
  getRateLimitInfo,
  rateLimitBody,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  _resetRateLimits
} from './_ratelimit.js';
import { sendJson } from './_schema.js';
import parseConstraintsHandler from './_handlers/parse-constraints.js';

function mockReq(ip = '9.9.9.9') {
  return { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` }, socket: { remoteAddress: ip } };
}

function mockRes() {
  const headers = {};
  const mock = {
    statusCode: 200,
    headers,
    body: null,
    ended: false,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
    end(b) { if (b !== undefined) mock.body = b; mock.ended = true; }
  };
  return mock;
}

test('enforceRateLimit stamps window state on the response', () => {
  _resetRateLimits();
  const res = mockRes();
  assert.equal(enforceRateLimit(mockReq(), res), true);
  const info = getRateLimitInfo(res);
  assert.ok(info, 'response should carry rateLimitInfo');
  assert.equal(info.limit, RATE_LIMIT);
  assert.equal(info.remaining, RATE_LIMIT - 1);
});

test('rateLimitBody returns null before enforcement, payload after', () => {
  _resetRateLimits();
  const res = mockRes();
  assert.equal(rateLimitBody(res), null);

  enforceRateLimit(mockReq(), res);
  const body = rateLimitBody(res);
  assert.deepEqual(
    Object.keys(body).sort(),
    ['limit', 'policy', 'remaining', 'reset', 'window_seconds']
  );
  assert.equal(body.limit, RATE_LIMIT);
  assert.equal(body.remaining, RATE_LIMIT - 1);
  assert.equal(body.window_seconds, RATE_WINDOW_MS / 1000);
  assert.ok(Number.isInteger(body.reset), 'reset should be epoch seconds');
});

test('sendJson embeds a rate_limit object after enforceRateLimit', () => {
  _resetRateLimits();
  const res = mockRes();
  enforceRateLimit(mockReq(), res);
  sendJson(res, { endpoint: '/api/test', ok: true });

  const parsed = JSON.parse(res.body);
  assert.equal(parsed.schema_version, '1');
  assert.ok(parsed.rate_limit, 'agent-facing body must carry rate_limit');
  assert.equal(parsed.rate_limit.limit, RATE_LIMIT);
  assert.equal(parsed.rate_limit.remaining, RATE_LIMIT - 1);
  // Body numbers must mirror the X-RateLimit-* headers exactly.
  assert.equal(String(parsed.rate_limit.limit), res.headers['X-RateLimit-Limit']);
  assert.equal(String(parsed.rate_limit.remaining), res.headers['X-RateLimit-Remaining']);
  assert.equal(String(parsed.rate_limit.reset), res.headers['X-RateLimit-Reset']);
});

test('sendJson without prior enforcement carries no rate_limit field', () => {
  _resetRateLimits();
  const res = mockRes();
  sendJson(res, { endpoint: '/api/test' });

  const parsed = JSON.parse(res.body);
  assert.equal(parsed.rate_limit, undefined);
  assert.equal(parsed.schema_version, '1');
});

test('sendJson never clobbers a rate_limit field the handler set itself', () => {
  _resetRateLimits();
  const res = mockRes();
  enforceRateLimit(mockReq(), res);
  sendJson(res, { rate_limit: { limit: 1, remaining: 0 } });

  const parsed = JSON.parse(res.body);
  assert.deepEqual(parsed.rate_limit, { limit: 1, remaining: 0 });
});

test('real agent endpoint response (/api/parse-constraints) carries rate_limit', async () => {
  _resetRateLimits();
  const req = mockReq('7.7.7.7');
  req.method = 'GET';
  req.query = { q: 'self-hosted Qwen 27B at Q4 for 10 users under $1500' };
  const res = mockRes();

  await parseConstraintsHandler(req, res);

  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.constraints, 'sanity: handler produced its normal payload');
  assert.ok(parsed.rate_limit, 'agent response must expose rate_limit in the body');
  assert.equal(parsed.rate_limit.limit, RATE_LIMIT);
  assert.equal(typeof parsed.rate_limit.remaining, 'number');
  assert.ok(parsed.rate_limit.remaining <= RATE_LIMIT);
  assert.equal(parsed.rate_limit.window_seconds, 60);
});
