// #948: /api/compute must not silently degrade an unparseable POST body to
// the 200 capability index. A POST that carries a payload which never made
// it into req.body (JSON without a Content-Type header, multipart, …) now
// fails loudly with problem+json 415 UNSUPPORTED_MEDIA_TYPE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { hasUnparsedBody } from './compute.js';
import { ERROR_CODES } from '../_errors.js';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    bodyText: null,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(c) { this.statusCode = c; return this; },
    end(b) { this.bodyText = b ?? null; }
  };
}

async function call(req) {
  const res = mockRes();
  await handler({
    method: 'POST',
    headers: {},
    query: {},
    ...req
  }, res);
  let body = null;
  try { body = res.bodyText ? JSON.parse(res.bodyText) : null; } catch { body = null; }
  return { status: res.statusCode, body, headers: res.headers };
}

test('registry exposes the new 415 code with canonical metadata', () => {
  assert.equal(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE.status, 415);
  assert.ok(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE.title.length > 0);
});

test('POST JSON without Content-Type header → 415 problem+json, not silent index', async () => {
  const { status, body } = await call({
    // Vercel leaves req.body undefined when it cannot parse the payload.
    headers: { 'content-length': '58' },
    body: undefined
  });
  assert.equal(status, 415);
  assert.equal(body.code, 'UNSUPPORTED_MEDIA_TYPE');
  assert.equal(body.status, 415);
  assert.match(body.detail, /Content-Type/);
});

test('POST chunked unparsed body → 415 as well', async () => {
  const { status, body } = await call({
    headers: { 'transfer-encoding': 'chunked' },
    body: undefined
  });
  assert.equal(status, 415);
  assert.equal(body.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('POST with parsed JSON body still computes (200 + id)', async () => {
  const { status, body } = await call({
    headers: { 'content-type': 'application/json', 'content-length': '64' },
    body: { model: 'kvCache' }
  });
  assert.equal(status, 200);
  assert.match(body.id, /^calc_[0-9a-f]{12}$/);
});

test('POST with parsed form-urlencoded body still computes', async () => {
  const { status, body } = await call({
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '20' },
    body: { model: 'kvCache' }
  });
  assert.equal(status, 200);
  assert.match(body.id, /^calc_[0-9a-f]{12}$/);
});

test('empty-body POST keeps the legacy 200 capability index', async () => {
  const { status, body } = await call({ headers: {}, body: undefined });
  assert.equal(status, 200);
  assert.ok(body.models || body.capabilities || body.endpoints || body.description,
    'expected the documented capability-index shape');
});

test('hasUnparsedBody classifies payloads correctly', () => {
  assert.equal(hasUnparsedBody({ headers: { 'content-length': '10' }, body: undefined }), true);
  assert.equal(hasUnparsedBody({ headers: { 'content-length': '0' }, body: undefined }), false);
  assert.equal(hasUnparsedBody({ headers: {}, body: undefined }), false);
  assert.equal(hasUnparsedBody({ headers: { 'transfer-encoding': 'chunked' }, body: 'raw string' }), true);
  assert.equal(hasUnparsedBody({ headers: { 'content-length': '5' }, body: {} }), false);
});
