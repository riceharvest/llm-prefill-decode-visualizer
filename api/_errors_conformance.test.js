// Agentic contract tests: RFC 9457 (problem+json) conformance.
//
// Agents branch on machine-readable error shape, not prose. _errors.test.js
// covers helper behavior; this file asserts the full RFC 9457 wire contract
// for EVERY registered error code, plus cross-checks that the OpenAPI spec's
// Problem schema and x-error-codes registry stay in sync with _errors.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  ERROR_CODES,
  problemBody,
  problemType,
  sendProblem,
  sendProblemFromError
} from './_errors.js';
import specHandler from './_handlers/spec.js';

const CODES = Object.keys(ERROR_CODES);

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  return res;
}

/** Render an error response for every code through the central handler. */
function renderProblem(fn, req) {
  const res = mockRes();
  fn(res, req);
  assert.equal(res.headers['content-type'], 'application/problem+json',
    'error responses must be served as application/problem+json');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

function fetchSpec() {
  const res = mockRes();
  specHandler({ method: 'GET', query: {}, headers: {}, url: '/api/spec' }, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(res.body);
}

test('every registered code renders a conformant RFC 9457 problem body', () => {
  for (const code of CODES) {
    const { status, json } = renderProblem((res) => sendProblem(res, null, { code }));
    // Required member set per RFC 9457 §3.1 + this API's stable `code`.
    assert.equal(typeof json.type, 'string', `${code}: type`);
    assert.equal(typeof json.title, 'string', `${code}: title`);
    assert.ok(json.title.length > 0, `${code}: title must be non-empty`);
    assert.equal(typeof json.status, 'number', `${code}: status`);
    // type is an absolute https URI derived from the kebab-cased code.
    assert.match(json.type, /^https:\/\/.+\/problems\/[a-z0-9-]+$/, `${code}: type URI shape`);
    assert.equal(json.type, problemType(code), `${code}: type matches registry URI`);
    assert.equal(json.code, code, `${code}: stable machine-readable code echoed`);
    assert.equal(json.title, ERROR_CODES[code].title, `${code}: title from registry`);
    assert.equal(status, ERROR_CODES[code].status, `${code}: HTTP status matches default`);
    assert.equal(json.status, status, `${code}: body status matches HTTP status`);
  }
});

test('problem bodies survive a JSON round-trip unchanged (no undefined leakage)', () => {
  for (const code of CODES) {
    const body = problemBody({
      code,
      detail: `detail for ${code}`,
      errors: [{ field: 'x', message: 'bad' }]
    });
    const parsed = JSON.parse(JSON.stringify(body));
    assert.deepEqual(parsed, body, `${code}: body must serialize losslessly`);
    for (const [k, v] of Object.entries(parsed)) {
      assert.notEqual(v, undefined, `${code}: member "${k}" serializes to undefined`);
    }
  }
});

test('optional members appear only when set: detail/instance/errors/extras', () => {
  const minimal = problemBody({ code: 'NOT_FOUND' });
  for (const member of ['detail', 'instance', 'errors']) {
    assert.equal(member in minimal, false, `bare problem must omit "${member}"`);
  }
  const full = problemBody({
    code: 'INVALID_PARAMS',
    detail: 'bad input',
    instance: '/api/compute?x=1',
    errors: [{ param: 'model', message: 'required' }],
    retryable: false
  });
  assert.equal(full.detail, 'bad input');
  assert.equal(full.instance, '/api/compute?x=1');
  assert.deepEqual(full.errors, [{ param: 'model', message: 'required' }]);
  assert.equal(full.retryable, false, 'extra members are preserved');
});

test('sendProblem fills instance from req.url when a request is given', () => {
  const { json } = renderProblem(
    (res, req) => sendProblem(res, req, { code: 'RATE_LIMITED', detail: 'slow down' }),
    { url: '/api/localmaxxing?limit=9999' }
  );
  assert.equal(json.instance, '/api/localmaxxing?limit=9999');
});

test('thrown ApiErrors keep their code and status through the central handler', () => {
  for (const code of CODES) {
    const err = new ApiError(code, `boom ${code}`);
    const { status, json } = renderProblem((res, req) => sendProblemFromError(res, req, err), { url: '/api/x' });
    assert.equal(json.code, code);
    assert.equal(status, ERROR_CODES[code].status);
    assert.equal(json.instance, '/api/x');
  }
});

test('spec Problem schema required-members match what problemBody always emits', () => {
  const spec = fetchSpec();
  const required = spec.components.schemas.Problem.required;
  // Members present on every possible problem body (code is API-specific).
  for (const member of ['type', 'title', 'status']) {
    assert.ok(required.includes(member), `Problem schema must require "${member}"`);
  }
  const declaredProps = new Set(Object.keys(spec.components.schemas.Problem.properties));
  for (const member of ['type', 'title', 'status', 'code']) {
    assert.ok(declaredProps.has(member), `Problem schema must declare "${member}"`);
  }
});

test('spec x-error-codes mirrors the ERROR_CODES registry exactly', () => {
  const spec = fetchSpec();
  const listed = spec['x-error-codes'];
  assert.deepEqual(
    listed.map(e => e.code),
    CODES,
    'x-error-codes must list exactly the codes in _errors.js, in order'
  );
  for (const entry of listed) {
    const meta = ERROR_CODES[entry.code];
    assert.equal(entry.httpStatus, meta.status);
    assert.equal(entry.type, problemType(entry.code));
    assert.equal(entry.title, meta.title);
    assert.equal(entry.description, meta.description);
  }
  // The Problem schema's code enum must accept every registry code.
  assert.deepEqual(
    [...spec.components.schemas.Problem.properties.code.enum],
    CODES
  );
});
