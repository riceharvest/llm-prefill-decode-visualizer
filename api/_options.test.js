// Central OPTIONS handling contract (issue #906): every /api/* route answers
// an OPTIONS probe with 204 + `Allow` derived from the route table, no body,
// and Cache-Control: no-store — never the GET representation, and never a
// publicly cacheable probe response.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/[...path].js';

async function callHandler(url, method = 'OPTIONS') {
  let ended = false;
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    end(body) {
      ended = true;
      this._body = body;
    },
  };
  await handler({ url, query: {}, headers: {}, method }, res);
  return { status: res.statusCode, headers: res.headers, body: res._body, ended };
}

test('OPTIONS on a GET-only endpoint returns 204 with Allow and no body', async () => {
  const { status, headers, body } = await callHandler('/api/spec');
  assert.equal(status, 204);
  assert.equal(headers.Allow, 'GET, OPTIONS');
  assert.equal(body, undefined);
});

test('OPTIONS responses are stamped no-store so probes never enter CDN caches', async () => {
  for (const url of ['/api/spec', '/api/presets', '/api/export', '/api/benchmarks']) {
    const { headers } = await callHandler(url);
    assert.equal(headers['Cache-Control'], 'no-store', `${url} must be no-store`);
    const cc = String(headers['Cache-Control']);
    assert.ok(!/public/.test(cc) && !/max-age/.test(cc), `${url}: ${cc}`);
  }
});

test('OPTIONS carries CORS preflight headers', async () => {
  const { headers } = await callHandler('/api/presets');
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
  assert.equal(headers['Access-Control-Allow-Methods'], 'GET, OPTIONS');
});

test('POST routes advertise POST in Allow', async () => {
  const compute = await callHandler('/api/compute');
  assert.equal(compute.status, 204);
  assert.equal(compute.headers.Allow, 'GET, POST, OPTIONS');

  const watch = await callHandler('/api/watch');
  assert.equal(watch.headers.Allow, 'GET, POST, DELETE, OPTIONS');
});

test('dynamic /calc/<id> routes get Allow too', async () => {
  const { status, headers } = await callHandler('/api/calc/my-calc-1');
  assert.equal(status, 204);
  assert.equal(headers.Allow, 'GET, OPTIONS');
});

test('agent endpoints answer OPTIONS without running their GET handler', async () => {
  const { status, headers } = await callHandler('/api/agent/freshness.json');
  assert.equal(status, 204);
  assert.equal(headers.Allow, 'GET, OPTIONS');
  assert.equal(headers['Cache-Control'], 'no-store');
});

test('mcp preflight keeps its extra allow-headers (Mcp-Session-Id)', async () => {
  const { status, headers } = await callHandler('/api/mcp');
  assert.equal(status, 204);
  assert.equal(headers.Allow, 'GET, POST, OPTIONS');
  assert.match(String(headers['Access-Control-Allow-Headers']), /Mcp-Session-Id/);
});

test('OPTIONS on an unknown path falls through to 404 — still no-store', async () => {
  const { status, headers } = await callHandler('/api/nope-does-not-exist');
  assert.equal(status, 404);
  assert.equal(headers['Cache-Control'], 'no-store');
});
