// HEAD Content-Length contract (issue #902).
//
// HEAD responses on /api/* must carry `Content-Length` matching the exact
// number of bytes the corresponding GET would return, so agents can pre-size
// downloads without blind-fetching multi-MB payloads. They must also set
// `Accept-Ranges: none` explicitly and never stream a body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import apiHandler from './[...path].js';

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    written: [],
    ended: false,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(this.headers, String(k).toLowerCase()); },
    write(chunk) {
      if (!this.ended) this.written.push(chunk == null ? '' : String(chunk));
      return true;
    },
    end(body) {
      if (body != null && !this.ended) this.written.push(String(body));
      this.ended = true;
      this.finalBody = this.written.join('');
      return this;
    }
  };
  return res;
}

async function call(method, url, headers = {}) {
  const res = makeRes();
  await apiHandler({ method, url: '/api' + url, query: {}, headers }, res);
  return res;
}

test('HEAD /api/export sets Content-Length equal to the GET body size', async () => {
  const head = await call('HEAD', '/export');
  assert.equal(head.statusCode, 200);
  const len = head.getHeader('Content-Length');
  assert.ok(len != null, 'Content-Length must be present on HEAD');
  const get = await call('GET', '/export');
  assert.equal(Number(len), Buffer.byteLength(get.finalBody),
    'HEAD Content-Length must match the GET body byte size');
});

test('HEAD /api/export?format=json reports the JSON size, not the CSV size', async () => {
  const head = await call('HEAD', '/export?format=json');
  const get = await call('GET', '/export?format=json');
  assert.equal(Number(head.getHeader('Content-Length')), Buffer.byteLength(get.finalBody));
});

test('HEAD /api/spec sets Content-Length equal to the GET body size', async () => {
  const head = await call('HEAD', '/spec');
  assert.equal(head.statusCode, 200);
  const get = await call('GET', '/spec');
  assert.equal(Number(head.getHeader('Content-Length')), Buffer.byteLength(get.finalBody));
});

test('HEAD /api/runs sets Content-Length equal to the GET body size', async () => {
  const head = await call('HEAD', '/runs');
  assert.equal(head.statusCode, 200);
  const get = await call('GET', '/runs');
  assert.equal(Number(head.getHeader('Content-Length')), Buffer.byteLength(get.finalBody));
});

test('HEAD /api/health carries Content-Length too', async () => {
  const head = await call('HEAD', '/health');
  assert.ok(head.getHeader('Content-Length') != null);
});

test('HEAD responses declare Accept-Ranges: none', async () => {
  const head = await call('HEAD', '/health');
  assert.equal(head.getHeader('Accept-Ranges'), 'none');
});

test('HEAD writes no body bytes', async () => {
  const head = await call('HEAD', '/spec');
  assert.equal(head.written.length, 0, `HEAD must not stream a body, got ${head.written.length} chunk(s)`);
  assert.equal((head.finalBody || ''), '');
});

test('HEAD preserves content-type and other metadata headers', async () => {
  const head = await call('HEAD', '/export');
  const get = await call('GET', '/export');
  assert.equal(head.getHeader('Content-Type'), get.getHeader('Content-Type'));
  assert.match(head.getHeader('Content-Disposition'), /attachment/);
});
