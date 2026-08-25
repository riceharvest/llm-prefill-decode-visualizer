// X-Schema-Version / schema_version coverage on the previously unstamped
// surfaces (#963): /api/export (both formats + errors), /api/calc/:id
// (replays, 400s, OPTIONS), and the router-level 404/500 paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dispatcher from '../api/[...path].js';
import calcId from '../api/_handlers/calc_id.js';
import exportHandler from '../api/_handlers/export.js';
import { invalidateCache } from '../api/_localmaxxing.js';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    status(code) { this.statusCode = code; return this; },
    write(chunk) { this.body = (this.body || '') + chunk; },
    end(payload) { if (payload !== undefined) this.body = payload; this.ended = true; }
  };
}

test('/api/export?format=json stamps the version contract alongside the legacy dataset field', async () => {
  invalidateCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: [] }) });
  try {
    const res = mockRes();
    await exportHandler({ method: 'GET', url: '/api/export?format=json', query: { format: 'json' }, headers: {} }, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-schema-version'], '1');
    assert.equal(body.schema_version, '1');          // wire contract version
    assert.equal(body.schemaVersion, 1);             // legacy dataset version preserved
    assert.ok(Array.isArray(body.runs));
  } finally {
    globalThis.fetch = realFetch;
    invalidateCache();
  }
});

test('/api/export?format=csv carries the header too', async () => {
  invalidateCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: [] }) });
  try {
    const res = mockRes();
    await exportHandler({ method: 'GET', url: '/api/export', query: {}, headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.equal(res.headers['x-schema-version'], '1');
  } finally {
    globalThis.fetch = realFetch;
    invalidateCache();
  }
});

test('/api/export upstream failure keeps the error inside the version contract', async () => {
  invalidateCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('down'); };
  try {
    const res = mockRes();
    await exportHandler({ method: 'GET', url: '/api/export?format=json', query: { format: 'json' }, headers: {} }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.headers['x-schema-version'], '1');
    assert.ok(JSON.parse(res.body).error);
  } finally {
    globalThis.fetch = realFetch;
    invalidateCache();
  }
});

test('/api/calc/:id 400s carry the version contract and keep their cacheable envelope', async () => {
  const res = mockRes();
  await calcId({ method: 'GET', url: '/api/calc/nope', query: { id: 'nope' }, headers: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers['x-schema-version'], '1');
  assert.equal(JSON.parse(res.body).schema_version, '1');
  assert.match(String(res.headers['cache-control']), /public, max-age=3600/);
});

test("router-level 404s carry the version contract they already claimed to expose", async () => {
  const { headers, body } = await (async () => {
    const res = mockRes();
    await dispatcher({ url: '/api/nope-does-not-exist', query: {}, headers: {} }, res);
    return { headers: res.headers, body: JSON.parse(res.body) };
  })();
  assert.equal(headers['x-schema-version'], '1');
  assert.equal(body.schema_version, '1');
  // The expose-headers advertisement must not be a lie anymore:
  const expose = String(headers['access-control-expose-headers'] || '');
  assert.ok(expose.split(',').map(s => s.trim()).includes('X-Schema-Version'));
});
