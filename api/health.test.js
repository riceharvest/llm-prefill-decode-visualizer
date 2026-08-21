import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './health.js';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; }
  };
}

test('GET /api/health returns ok with required fields', () => {
  const res = mockRes();
  handler({ method: 'GET' }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(res.headers['Cache-Control'], 'no-store');

  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.service, 'llm-prefill-decode-visualizer');
  assert.equal(typeof body.time, 'string');
  assert.ok(!Number.isNaN(Date.parse(body.time)));

  // Required contract fields for the status page
  assert.ok(['fresh', 'stale', 'empty'].includes(body.upstreamFreshness.status));
  assert.equal(body.cacheAge, body.upstreamFreshness.ageSeconds);
});

test('health reflects empty cache as status=empty with null ages', async () => {
  const { invalidateCache } = await import('./_localmaxxing.js');
  invalidateCache();
  const res = mockRes();
  handler({ method: 'GET' }, res);
  const body = JSON.parse(res.body);
  assert.equal(body.upstreamFreshness.status, 'empty');
  assert.equal(body.cacheAge, null);
  assert.equal(body.upstreamFreshness.fetchedAt, null);
});
