import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_CODES,
  ApiError,
  problemBody,
  problemType,
  sendProblem,
  sendProblemFromError,
  sendRateLimited,
  toApiError
} from './_errors.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

test('every registered code has a valid HTTP status and title', () => {
  for (const [code, meta] of Object.entries(ERROR_CODES)) {
    assert.ok(Number.isInteger(meta.status) && meta.status >= 400 && meta.status < 600, `${code} status`);
    assert.equal(typeof meta.title, 'string');
    assert.ok(meta.title.length > 0);
    assert.equal(typeof meta.description, 'string');
  }
  // The four stable codes required by the error taxonomy.
  for (const code of ['INVALID_PARAMS', 'UPSTREAM_UNAVAILABLE', 'RATE_LIMITED', 'NOT_FOUND']) {
    assert.ok(ERROR_CODES[code], `missing stable code ${code}`);
  }
});

test('problemType maps codes to stable kebab-case URIs', () => {
  assert.equal(problemType('INVALID_PARAMS'), 'https://llm-prefill-decode-visualizer.vercel.app/problems/invalid-params');
  assert.match(problemType('UPSTREAM_UNAVAILABLE'), /\/problems\/upstream-unavailable$/);
});

test('problemBody emits the RFC 9457 member set with a machine-readable code', () => {
  const body = problemBody({
    status: 400,
    code: 'INVALID_PARAMS',
    detail: 'Unknown model nope',
    instance: '/api/compute?model=nope'
  });
  assert.equal(body.type, problemType('INVALID_PARAMS'));
  assert.equal(body.title, 'Invalid parameters');
  assert.equal(body.status, 400);
  assert.equal(body.detail, 'Unknown model nope');
  assert.equal(body.instance, '/api/compute?model=nope');
  assert.equal(body.code, 'INVALID_PARAMS');
});

test('problemBody defaults status/title from the registry and rejects unknown codes', () => {
  const body = problemBody({ code: 'UPSTREAM_UNAVAILABLE', detail: 'x' });
  assert.equal(body.status, 502);
  assert.equal(body.title, 'Upstream unavailable');

  const fallback = problemBody({ code: 'NOT_A_REAL_CODE' });
  assert.equal(fallback.code, 'INTERNAL');
  assert.equal(fallback.status, 500);
});

test('sendProblem sets application/problem+json, CORS, and no-store caching', () => {
  const res = mockRes();
  sendProblem(res, { url: '/api/best?by=decode' }, { code: 'UPSTREAM_UNAVAILABLE', detail: 'leaderboard down' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.headers['Content-Type'], 'application/problem+json');
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(body.instance, '/api/best?by=decode');
});

test('ApiError carries code/status through toApiError; unknown throws become INTERNAL', () => {
  const e = new ApiError('INVALID_PARAMS', 'bad input');
  assert.equal(e.code, 'INVALID_PARAMS');
  assert.equal(e.status, 400);

  const wrapped = toApiError(new TypeError('cannot read property x'));
  assert.equal(wrapped.code, 'INTERNAL');
  assert.equal(wrapped.status, 500);
  assert.match(wrapped.detail, /cannot read property x/);
});

test('sendProblemFromError renders ApiErrors with their own code and extras', () => {
  const res = mockRes();
  sendProblemFromError(res, { url: '/api/compute?batch=1' }, new ApiError('INVALID_PARAMS', 'too many items', { extras: { maxSize: 50 } }));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 400);
  assert.equal(body.code, 'INVALID_PARAMS');
  assert.equal(body.maxSize, 50);
  assert.equal(body.instance, '/api/compute?batch=1');
});

test('sendRateLimited emits a 429 RATE_LIMITED problem with Retry-After', () => {
  const res = mockRes();
  sendRateLimited(res, { url: '/api/localmaxxing' }, { retryAfter: 30 });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '30');
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'RATE_LIMITED');
  assert.equal(body.title, 'Rate limited');
});
