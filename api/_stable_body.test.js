// Issue #697 — byte-stable bodies: ?stable=1 must omit the volatile
// rate_limit block so identical requests produce identical bytes, while the
// default wire format keeps embedding it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { sendJson, applyStableBodyMode, withSchemaVersion } = await import('./_schema.js');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    hasHeader(k) { return k in this.headers; },
    end(payload) { if (payload !== undefined) this.chunks.push(payload); }
  };
}

function send(res, body) {
  sendJson(res, body);
  return res.chunks.join('');
}

test('default: volatile rate_limit.remaining is embedded (back-compat)', () => {
  const res = mockRes();
  res.rateLimitInfo = { allowed: true, limit: 120, remaining: 42, resetEpochSec: 123 };
  const body = JSON.parse(send(res, { hello: 'world' }));
  assert.equal(body.rate_limit.remaining, 42);
});

test('stable mode: two calls with DIFFERENT counters are byte-identical (#697)', () => {
  const bodies = [118, 107].map(remaining => {
    const res = mockRes();
    res.stableBody = true;
    res.rateLimitInfo = { allowed: true, limit: 120, remaining, resetEpochSec: 999 };
    return send(res, { id: 'calc_x', ttftSeconds: 1.07 });
  });
  assert.equal(bodies[0], bodies[1], 'bodies hash-identical under stable=1');
  const parsed = JSON.parse(bodies[0]);
  assert.equal(parsed.rate_limit, undefined, 'rate_limit omitted under stable=1');
});

test('applyStableBodyMode parses ?stable=1 / stable=true and ignores junk', () => {
  const on1 = mockRes();
  assert.equal(applyStableBodyMode({ url: '/api/compute?model=singleTurn&stable=1' }, on1), true);
  assert.equal(on1.stableBody, true);

  const on2 = mockRes();
  assert.equal(applyStableBodyMode({ url: '/api/best?by=decode&stable=true' }, on2), true);

  const off = mockRes();
  assert.equal(applyStableBodyMode({ url: '/api/compute?model=singleTurn&stable=0' }, off), false);
  assert.equal(off.stableBody, undefined);

  const none = mockRes();
  assert.equal(applyStableBodyMode({ url: '/api/compute?model=singleTurn' }, none), false);
});

test('X-RateLimit-* headers stay CORS-exposed for browser agents', () => {
  const res = mockRes();
  sendJson(res, { a: 1 });
  const expose = String(res.headers['Access-Control-Expose-Headers'] || '');
  for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) {
    assert.ok(expose.includes(h), `${h} exposed`);
  }
});
