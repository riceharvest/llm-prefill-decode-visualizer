// Tests for response revalidation + cache-safety contracts in sendJson().
//
//   #584 — every 200 JSON response carries a strong ETag over the exact
//          serialized body, and If-None-Match that matches yields a body-less
//          304 so agents can revalidate after max-age lapses.
//   #590 — per-client rate-limit data (the `rate_limit` body field and the
//          X-RateLimit-* headers) must NEVER ride on a publicly (shared-)
//          cacheable response, because the edge replays one client's counters
//          to every other client for up to an hour. Uncached responses keep
//          both, as documented in llms.txt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceRateLimit, _resetRateLimits } from './_ratelimit.js';
import { sendJson } from './_schema.js';

function mockReq(headers = {}) {
  return { headers, socket: { remoteAddress: '9.9.9.9' } };
}

function mockRes(req = null) {
  const headers = new Map();
  const res = {
    req,
    statusCode: 200,
    endedBody: undefined,
    get headers() { return Object.fromEntries(headers); },
    setHeader(k, v) { headers.set(String(k).toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    hasHeader(k) { return headers.has(String(k).toLowerCase()); },
    removeHeader(k) { headers.delete(String(k).toLowerCase()); },
    end(body) { res.endedBody = body; }
  };
  return res;
}

const BODY = { hello: 'world', n: 1 };

test('#584: 200 responses carry a strong quoted ETag derived from the body', () => {
  const res = mockRes(mockReq());
  sendJson(res, BODY);
  const etag = res.getHeader('ETag');
  assert.match(etag, /^"[0-9a-f]{32}"$/, 'strong sha256-derived validator');
});

test('#584: identical bodies → identical ETag; different bodies → different ETag', () => {
  const a = mockRes(mockReq());
  const b = mockRes(mockReq());
  const c = mockRes(mockReq());
  sendJson(a, BODY);
  sendJson(b, structuredClone(BODY));
  sendJson(c, { ...BODY, n: 2 });
  assert.equal(a.getHeader('ETag'), b.getHeader('ETag'));
  assert.notEqual(a.getHeader('ETag'), c.getHeader('ETag'));
});

test('#584: matching If-None-Match → 304 with empty body', () => {
  const first = mockRes(mockReq());
  sendJson(first, BODY);
  const etag = first.getHeader('ETag');

  const revalidate = mockRes(mockReq({ 'if-none-match': etag }));
  sendJson(revalidate, BODY);
  assert.equal(revalidate.statusCode, 304);
  assert.equal(revalidate.endedBody, undefined, '304 carries no body');
  assert.equal(revalidate.getHeader('ETag'), etag);
  assert.equal(revalidate.getHeader('Content-Type'), 'application/json; charset=utf-8');
});

test('#584: stale or absent If-None-Match → full 200 body', () => {
  const stale = mockRes(mockReq({ 'if-none-match': '"00000000000000000000000000000000"' }));
  sendJson(stale, BODY);
  assert.equal(stale.statusCode, 200);
  assert.deepEqual(JSON.parse(stale.endedBody), { ...BODY, schema_version: '1' });

  const fresh = mockRes(mockReq());
  sendJson(fresh, BODY);
  assert.equal(fresh.statusCode, 200);
  assert.ok(fresh.endedBody.length > 0);
});

test('#584: weak validators and list/* forms of If-None-Match are honored', () => {
  const first = mockRes(mockReq());
  sendJson(first, BODY);
  const etag = first.getHeader('ETag');

  for (const inm of [`W/${etag}`, `${etag}, "deadbeef"`, '*']) {
    const res = mockRes(mockReq({ 'if-none-match': inm }));
    sendJson(res, BODY);
    assert.equal(res.statusCode, 304, `If-None-Match: ${inm} should revalidate`);
  }
});

test('#584: no ETag on error statuses', () => {
  const res = mockRes(mockReq());
  sendJson(res, { error: 'boom' }, { status: 502 });
  assert.equal(res.getHeader('ETag'), undefined);
  assert.equal(res.statusCode, 502);
});

test('#584: no ETag when the client negotiates markdown (different representation)', () => {
  const res = mockRes(mockReq({ accept: 'text/markdown' }));
  sendJson(res, BODY);
  assert.equal(res.getHeader('ETag'), undefined);
  assert.equal(res.statusCode, 200);
});

test('#584: ETag is exposed to browser CORS clients', () => {
  const res = mockRes(mockReq());
  sendJson(res, BODY);
  assert.ok(res.getHeader('Access-Control-Expose-Headers').includes('ETag'));
});

test('#590: publicly cacheable response omits per-client rate_limit body field', () => {
  _resetRateLimits();
  const res = mockRes(mockReq());
  assert.equal(enforceRateLimit(mockReq(), res), true);
  sendJson(res, { endpoint: '/api/spec' }, { cacheTtl: 3600 });

  const parsed = JSON.parse(res.endedBody);
  assert.equal(parsed.rate_limit, undefined, 'shared-cacheable body must not carry one client\'s counters');
  assert.equal(res.getHeader('Cache-Control'), 'public, max-age=3600');
});

test('#590: X-RateLimit-* headers are stripped from publicly cacheable responses too', () => {
  _resetRateLimits();
  const res = mockRes(mockReq());
  enforceRateLimit(mockReq(), res);
  assert.ok(res.getHeader('X-RateLimit-Remaining') !== undefined, 'sanity: enforcement stamped headers');
  sendJson(res, { ok: true }, { cacheTtl: 600 });

  for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) {
    assert.equal(res.getHeader(h), undefined, `${h} would be edge-replayed to other clients`);
  }
});

test('#590: uncached responses keep the documented rate_limit mirror', () => {
  _resetRateLimits();
  const res = mockRes(mockReq());
  enforceRateLimit(mockReq(), res);
  sendJson(res, { endpoint: '/api/compute' }); // no cacheTtl, no preset Cache-Control

  const parsed = JSON.parse(res.endedBody);
  assert.ok(parsed.rate_limit, 'uncached agent-facing body still carries rate_limit');
  assert.equal(parsed.rate_limit.limit, 120);
  assert.notEqual(res.getHeader('X-RateLimit-Remaining'), undefined);
});

test('#590: handler-set no-store/private Cache-Control keeps rate_limit', () => {
  _resetRateLimits();
  const res = mockRes(mockReq());
  enforceRateLimit(mockReq(), res);
  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, { ok: true }, { cacheTtl: 600 });

  const parsed = JSON.parse(res.endedBody);
  assert.ok(parsed.rate_limit, 'private/no-store responses may carry per-client quota');
});
