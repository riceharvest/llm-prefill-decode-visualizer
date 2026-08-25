// Contract tests for the error-contract fixes (#687 #707 #723).
// Exercises the real catch-all dispatcher and batch path end-to-end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dispatcher from './[...path].js';
import { computeBody } from './_handlers/compute.js';

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    hasHeader(k) { return k.toLowerCase() in this.headers; },
    end(payload) { this.ended = true; if (payload !== undefined) this.body = payload; }
  };
  return res;
}

test('#687: uncaught handler throw renders RFC 9457 INTERNAL problem+json, not raw message', async () => {
  // /api/export with a bogus type throws inside the handler (no internal
  // try/catch) — exactly the path that used to leak `String(err.message)`.
  const res = mockRes();
  await dispatcher({ method: 'GET', url: '/api/export?type=___uncaught__', query: { type: '___uncaught__' }, headers: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.headers['content-type'], 'application/problem+json');
  assert.equal(res.headers['cache-control'], 'no-store');
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INTERNAL');
  assert.equal(body.status, 500);
  assert.equal(typeof body.title, 'string');
  assert.match(body.type, /^https:\/\/.+\/problems\/internal$/);
  assert.equal(body.instance, '/api/export?type=___uncaught__');
  // Raw internal engine text (e.g. "res.write is not a function") must NOT leak.
  assert.ok(!/res\.write/.test(res.body), 'raw internal message leaked into problem body');
});

test('#687: unknown routes get problem+json NOT_FOUND (was ad-hoc {error} shape)', async () => {
  const res = mockRes();
  await dispatcher({ method: 'GET', url: '/api/nope', query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['content-type'], 'application/problem+json');
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'NOT_FOUND');
  assert.equal(body.status, 404);
  assert.match(body.detail, /'\/nope'/);
});

test('#707: all-failure batch returns BATCH_ALL_FAILED problem+json, never a 200 envelope', () => {
  // computeBody throws ApiError for total failure — capture it.
  let out;
  try {
    out = computeBody({ batch: [{ model: 'bogus1' }, { model: 'bogus2' }] });
  } catch (err) {
    out = err;
  }
  assert.equal(out.name, 'ApiError');
  assert.equal(out.code, 'BATCH_ALL_FAILED');
  assert.equal(out.status, 400);
  const problem = out.toProblem('/api/compute');
  assert.equal(problem.status, 400);
  assert.ok(Array.isArray(problem.errors));
  assert.equal(problem.errors.length, 2);
  for (const item of problem.errors) {
    assert.equal(item.code, 'INVALID_PARAMS');
    assert.equal(item.status, 400);
    assert.match(item.type, /\/problems\/invalid-params$/);
  }
});

test('#707: partial batch keeps 200 + per-item status/type, stamps id only when okCount > 0', () => {
  const okBatch = { batch: [{ model: 'singleTurn', promptTokens: 2048 }, { model: 'nope' }] };
  const out = computeBody(okBatch);
  assert.equal(out.status, 200);
  assert.equal(out.body.okCount, 1);
  assert.equal(out.body.errorCount, 1);
  // id present because at least one item computed
  assert.match(out.body.id, /^calc_/);
  const failed = out.body.results.find(r => !r.ok);
  assert.equal(failed.code, 'INVALID_PARAMS');
  assert.equal(failed.status, 400);
  assert.match(failed.type, /\/problems\/invalid-params$/);

  // dry-run behaves identically for failures (#707/#17)
  let threw = false;
  try {
    computeBody({ batch: [{ model: 'bogus1' }], dry_run: true });
  } catch (err) {
    threw = err.code === 'BATCH_ALL_FAILED';
  }
  assert.ok(threw, 'dry-run all-fail batch should also throw BATCH_ALL_FAILED');
});
