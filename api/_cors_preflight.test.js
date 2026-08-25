// Issue #634: unified CORS preflight across the API.
//
// Before the fix: /api/vram's OPTIONS omitted Access-Control-Allow-Headers
// entirely; every catch-all route answered OPTIONS with a full 200 GET body
// and no Allow-Methods/Allow-Headers at all; and X-Request-Id — echoed on
// every response and documented for browser fetch() consumers — was
// allowlisted nowhere, so cross-origin browser agents could never send it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/[...path].js';
import { sendPreflight, PREFLIGHT_ALLOW_HEADERS } from '../api/_cors.js';
import { ROUTES } from '../api/_route_table.js';

async function options(url, headers = {}) {
  const res = {
    statusCode: 0,
    headers: {},
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    hasHeader() { return false; },
    end() { this.ended = true; }
  };
  await handler({ url, method: 'OPTIONS', query: {}, headers }, res);
  return res;
}

test('OPTIONS on a route served by the catch-all answers 204 with a full preflight', async () => {
  for (const url of ['/api/spec', '/api/best', '/api/diff', '/api/compute']) {
    const res = await options(url);
    assert.equal(res.statusCode, 204, url);
    assert.equal(res.ended, true, `${url} must not answer OPTIONS with a GET body`);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.ok(res.headers['access-control-allow-methods'], url);
    assert.ok(!res.headers['content-type'], `${url} must not serve a body`);
  }
});

test('Allow-Headers always includes Content-Type, Accept and X-Request-Id (#634 point 3)', async () => {
  const res = await options('/api/spec');
  const allowHeaders = res.headers['access-control-allow-headers'].split(',').map(s => s.trim());
  for (const h of PREFLIGHT_ALLOW_HEADERS) assert.ok(allowHeaders.includes(h), h);
});

test('methods come from the central route table (POST routes advertise POST)', async () => {
  const res = await options('/api/compute');
  assert.match(res.headers['access-control-allow-methods'], /POST/);
  const getOnly = await options('/api/spec');
  const methods = getOnly.headers['access-control-allow-methods'];
  assert.ok(methods.includes('GET'));
  assert.ok(!methods.includes('POST'));
});

test('every route-table path gets the uniform preflight shape', async () => {
  for (const route of ROUTES) {
    if (route.path === '/mcp') continue; // mcp keeps its richer own preflight
    const res = await options(`/api${route.path}`);
    assert.equal(res.statusCode, 204, route.path);
    assert.equal(res.headers['access-control-allow-origin'], '*', route.path);
    assert.ok(res.headers['access-control-allow-headers'], route.path);
    assert.ok(res.headers['access-control-max-age'], route.path);
    // Preflights are per-client negotiations, never edge-cacheable.
    assert.equal(res.headers['cache-control'], 'no-store', route.path);
  }
});

test('/mcp intentionally keeps its own richer preflight (Mcp-Session-Id)', async () => {
  const res = await options('/api/mcp');
  // mcp.js answers OPTIONS itself with Mcp-Session-Id in the allowlist —
  // the shared dispatcher interception deliberately skips it.
  assert.equal(res.statusCode, 204);
  assert.match(res.headers['access-control-allow-headers'], /Mcp-Session-Id/);
});

test('the shared helper dedupes and appends extra allow headers case-insensitively', () => {
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end() {}
  };
  sendPreflight({}, res, { methods: ['POST'], extraAllowHeaders: ['x-request-id', 'Mcp-Session-Id'] });
  const list = res.headers['access-control-allow-headers'].split(',').map(s => s.trim());
  assert.equal(list.filter(h => h.toLowerCase() === 'x-request-id').length, 1);
  assert.ok(list.includes('Mcp-Session-Id'));
});
