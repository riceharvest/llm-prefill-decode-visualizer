import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etagFor, ifNoneMatchMatches, sendJson } from './_respond.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.ended = true; if (payload !== undefined) this.body = payload; }
  };
}

test('sendJson stamps CORS, Cache-Control, Content-Type and a strong ETag', () => {
  const res = mockRes();
  const body = { hello: 'world' };
  sendJson({ headers: {} }, res, body, { cacheTtl: 123 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(res.headers['Cache-Control'], 'public, max-age=123');
  assert.match(res.headers.ETag, /^"[0-9a-f]{32}"$/);
  assert.equal(res.body, JSON.stringify(body, null, 2));
});

test('ETag is content-addressed: different bodies get different validators', () => {
  assert.notEqual(etagFor(JSON.stringify({ a: 1 })), etagFor(JSON.stringify({ a: 2 })));
  assert.equal(etagFor('x'), etagFor('x'));
});

test('matching If-None-Match yields 304 with no body', () => {
  const first = mockRes();
  sendJson({ headers: {} }, first, { n: 1 });
  const etag = first.headers.ETag;

  const second = mockRes();
  sendJson({ headers: { 'if-none-match': etag } }, second, { n: 1 });
  assert.equal(second.statusCode, 304);
  assert.equal(second.body, undefined);
  assert.equal(second.headers.ETag, etag);
  // conditional validators must still be present on the 304
  assert.ok(second.headers['Cache-Control']);
});

test('stale If-None-Match gets a fresh 200', () => {
  const res = mockRes();
  sendJson({ headers: { 'if-none-match': '"deadbeefdeadbeefdeadbeefdeadbeef"' } }, res, { n: 1 });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body);
});

test('weak validators (W/ prefix) and multi-value headers still match', () => {
  const etag = '"abc123"';
  assert.equal(ifNoneMatchMatches(`W/${etag}`, etag), true);
  assert.equal(ifNoneMatchMatches(`w/${etag}`, etag), true);
  assert.equal(ifNoneMatchMatches(`"zzz", ${etag}`, etag), true);
  assert.equal(ifNoneMatchMatches('"other"', etag), false);
  assert.equal(ifNoneMatchMatches(undefined, etag), false);
});
