// #517 — read-only GET endpoints must reject mutating HTTP methods with
// 405 + Allow: GET (problem+json) instead of silently succeeding with a
// full 200 payload. Documented mutating routes stay untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const handler = (await import(path.join(here, '[...path].js'))).default;

function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    hasHeader() { return false; },
    removeHeader(k) { delete headers[String(k).toLowerCase()]; },
    end(body) { this.body = body; }
  };
}

async function call(url, method = 'GET') {
  const res = mockRes();
  const u = new URL(url, 'https://unit.test');
  await handler({ method, url: u.pathname + u.search, query: Object.fromEntries(u.searchParams.entries()), headers: {} }, res);
  return res;
}

test('#517: POST on a read-only route → 405 problem+json with Allow: GET', async () => {
  const res = await call('/api/presets', 'POST');
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers['allow'], 'GET');
  assert.match(String(res.headers['content-type']), /application\/problem\+json/);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'METHOD_NOT_ALLOWED');
  assert.equal(body.status, 405);
});

test('#517: DELETE /api/compute-adjacent read-only route is rejected too', async () => {
  for (const [url, method] of [
    ['/api/best', 'DELETE'],
    ['/api/benchmarks', 'PUT'],
    ['/api/version', 'DELETE'],
    ['/api/spec', 'PATCH'],
    ['/api/calc/calc_abc123def456', 'DELETE']
  ]) {
    const res = await call(url, method);
    assert.equal(res.statusCode, 405, `${method} ${url} should be 405`);
    assert.equal(res.headers['allow'], 'GET');
  }
});

test('#517: documented mutating verbs are not intercepted', async () => {
  // POST /api/diff reaches the diff handler (which validates the body) —
  // the key assertion is that it does NOT come back as our guard's 405
  // with an Allow: GET header.
  const res = await call('/api/diff', 'POST');
  const guarded = res.statusCode === 405 && res.headers['allow'] === 'GET';
  assert.equal(guarded, false, 'POST /api/diff must pass through to its handler');
});

test('#517: OPTIONS on read-only routes answers 204 with Allow: GET, OPTIONS', async () => {
  const res = await call('/api/presets', 'OPTIONS');
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-methods'], 'GET, OPTIONS');
});

test('#517: GET still works on guarded routes', async () => {
  const res = await call('/api/version');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.schema_version || body.version != null || body.schemaVersion != null);
});
