// Regression tests for #747: POST /api/diff with a malformed JSON body must
// return 400 (client input error), not 502 — 5xx invites retry loops on
// non-retryable input. Also pins the statusFromError mapping used by the
// handler's top-level catch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { statusFromError } from './diff.js';

/** Mock res capturing status + body. */
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { res.headers[k] = v; },
    end(body) { res.body = body; }
  };
  return res;
}

function bodyRequest(text) {
  // Minimal async-iterable request body (readJsonBody iterates req).
  const chunks = text === null ? [] : [Buffer.from(text)];
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    query: {},
    on() {}, // readJsonBody requires a stream-shaped req
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }) };
    }
  };
}

test('#747 malformed POST /api/diff JSON returns 400, not 502', async () => {
  const res = mockRes();
  await handler(bodyRequest('{bad'), res);
  assert.equal(res.statusCode, 400);
  const parsed = JSON.parse(res.body);
  assert.match(parsed.error, /not valid JSON/);
});

test('GET without run ids still returns the existing 400 missing-parameters shape', async () => {
  const res = mockRes();
  await handler({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'missing parameters');
});

test('statusFromError honors 4xx statusCode and falls back to 502 otherwise', () => {
  assert.equal(statusFromError(Object.assign(new Error('x'), { statusCode: 400 })), 400);
  assert.equal(statusFromError(Object.assign(new Error('x'), { statusCode: 422 })), 422);
  // 5xx-class or missing statusCode stays 502 (genuine upstream/unexpected).
  assert.equal(statusFromError(Object.assign(new Error('x'), { statusCode: 503 })), 502);
  assert.equal(statusFromError(new Error('boom')), 502);
  assert.equal(statusFromError(undefined), 502);
});
