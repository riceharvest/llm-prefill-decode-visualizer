// Tests for the RFC 9457 problem-type documentation route (#1093 #1108).
//
// Every problem+json body advertises `type: <BASE>/problems/<slug>`; before
// this handler existed those URIs dead-ended on the SPA's HTML 404. These
// tests pin the contract: every advertised slug must resolve, and the doc
// must agree with the ERROR_CODES registry that feeds the problem bodies.

import test from 'node:test';
import assert from 'node:assert/strict';
import problems, { problemDoc } from './_handlers/problems.js';
import { ERROR_CODES, problemType } from './_errors.js';

function mockReq({ query = {} } = {}) {
  return { method: 'GET', query };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    hasHeader(k) { return k in this.headers; },
    end(b) { this.body = b; }
  };
}

test('every ERROR_CODES slug resolves to a doc matching its registry entry', () => {
  for (const code of Object.keys(ERROR_CODES)) {
    const res = mockRes();
    problems(mockReq({ query: { code } }), res);

    assert.equal(res.statusCode, 200, code);
    assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
    const body = JSON.parse(res.body);
    assert.equal(body.code, code);
    assert.equal(body.title, ERROR_CODES[code].title);
    assert.equal(body.status, ERROR_CODES[code].status);
    assert.equal(body.description, ERROR_CODES[code].description);
    // The `type` URI in the doc must equal what problem bodies advertise.
    assert.equal(body.type, problemType(code));
    assert.ok(body.spec.endsWith('/api/spec'));
  }
});

test('every advertised problem type URI slug resolves via the path param', () => {
  for (const code of Object.keys(ERROR_CODES)) {
    const slug = new URL(problemType(code)).pathname.split('/').pop();
    assert.ok(slug, code);
    const res = mockRes();
    problems(mockReq({ query: { code: slug } }), res);

    assert.equal(res.statusCode, 200, `slug ${slug} (from ${code}) must resolve`);
    assert.equal(JSON.parse(res.body).code, code);
  }
});

test('registry index lists every code', () => {
  const res = mockRes();
  problems(mockReq(), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(
    body.codes.map((c) => c.code).sort(),
    Object.keys(ERROR_CODES).sort()
  );
});

test('unknown codes return 404 with the available slugs — never HTML', () => {
  const res = mockRes();
  problems(mockReq({ query: { code: 'nope-gone' } }), res);

  assert.equal(res.statusCode, 404);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'Unknown problem code');
  assert.ok(body.available.includes('invalid-params'));
  assert.ok(body.available.includes('rate-limited'));
});

test('underscore codes map to dashed slugs bidirectionally', () => {
  const res1 = mockRes();
  problems(mockReq({ query: { code: 'INVALID_PARAMS' } }), res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(JSON.parse(res1.body).slug, 'invalid-params');

  const res2 = mockRes();
  problems(mockReq({ query: { code: 'invalid_params' } }), res2);
  assert.equal(JSON.parse(res2.body).code, 'INVALID_PARAMS');
});

test('problemDoc is a pure function of the registry', () => {
  const doc = problemDoc('RATE_LIMITED');
  assert.equal(doc.slug, 'rate-limited');
  assert.match(doc.type, /\/problems\/rate-limited$/);
  assert.equal(doc.status, 429);
});
