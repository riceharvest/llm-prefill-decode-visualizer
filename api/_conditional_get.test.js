import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendJson, withConditionalGet, etagFor } from './_schema.js';
import { SCHEMA_VERSION } from './_schema.js';

// Mock req/res mirroring the pattern used by _markdown.test.js / _schema.test.js.
function mockRes() {
  const headers = {};
  const res = {
    headers,
    statusCode: 200,
    body: undefined,
    ended: false,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
    removeHeader(k) { delete headers[k]; }
  };
  res.end = function end(chunk) {
    this.ended = true;
    this.body = chunk;
  };
  return res;
}

const BODY = { ok: true, value: 42 };

test('#606: JSON responses gain a strong ETag computed from the exact bytes', () => {
  const req = { headers: {} };
  const res = mockRes();
  withConditionalGet(req, res);
  sendJson(res, BODY);
  const expected = etagFor(res.body);
  assert.match(expected, /^"[A-Za-z0-9_-]{40,}"$/);
  assert.equal(res.headers['ETag'], expected);
  // Exposed to browser fetch() consumers alongside the other custom headers.
  assert.ok(String(res.headers['Access-Control-Expose-Headers']).includes('ETag'));
});

test('#606: identical bodies → identical ETag; different bodies → different ETag', () => {
  assert.equal(etagFor('{"a":1}'), etagFor('{"a":1}'));
  assert.notEqual(etagFor('{"a":1}'), etagFor('{"a":2}'));
});

test('#606: matching If-None-Match → empty-bodied 304', () => {
  const req = { headers: {} };
  const first = mockRes();
  withConditionalGet(req, first);
  sendJson(first, BODY);
  const etag = first.headers['ETag'];

  const res2 = mockRes();
  withConditionalGet({ headers: { 'if-none-match': etag } }, res2);
  sendJson(res2, BODY);
  assert.equal(res2.statusCode, 304);
  assert.equal(res2.body, undefined);
  assert.equal(res2.headers['ETag'], etag);
});

test('#606: non-matching If-None-Match → full 200 with the body', () => {
  const res = mockRes();
  withConditionalGet({ headers: { 'if-none-match': '"stale"' } }, res);
  sendJson(res, BODY);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('"ok"'));
});

test('#606: W/ prefix and list forms use weak comparison; * matches anything', () => {
  const probe = mockRes();
  withConditionalGet({ headers: {} }, probe);
  sendJson(probe, BODY);
  const etag = probe.headers['ETag'];

  for (const inm of [`W/${etag}`, `"x", ${etag}`, '*']) {
    const res = mockRes();
    withConditionalGet({ headers: { 'if-none-match': inm } }, res);
    sendJson(res, BODY);
    assert.equal(res.statusCode, 304, `If-None-Match: ${inm}`);
  }
});

test('#606: non-200 and non-JSON responses pass through untouched', () => {
  const res404 = mockRes();
  res404.statusCode = 404;
  withConditionalGet({ headers: { 'if-none-match': '*' } }, res404);
  sendJson(res404, { error: 'nope' }, { status: 404 });
  assert.equal(res404.statusCode, 404);
  assert.ok(res404.body.includes('nope'));

  const resHtml = mockRes();
  resHtml.setHeader('Content-Type', 'text/html');
  withConditionalGet({ headers: { 'if-none-match': '*' } }, resHtml);
  resHtml.end('<html></html>');
  assert.ok(resHtml.body.includes('<html>'));
});
