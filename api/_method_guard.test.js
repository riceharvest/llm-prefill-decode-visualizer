// Regression tests for #538: /api/compute and /api/spec answered EVERY HTTP
// verb with their GET payload even though /api/spec documents 405
// METHOD_NOT_ALLOWED (problem+json). Wrong verbs must now get a problem+json
// 405 with an RFC 9110 §15.5.5 Allow header; documented verbs pass through.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import handler from './[...path].js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(this.headers, k); },
    end(payload) { if (payload !== undefined) this.body += payload; }
  };
}

// Case-insensitive header lookup for mock res objects.
function header(res, name) {
  const key = Object.keys(res.headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? res.headers[key] : undefined;
}

async function call(method, url) {
  const res = mockRes();
  await handler({ method, url, headers: {}, query: {} }, res);
  return res;
}

test('#538: DELETE/PATCH/PUT on /api/spec -> 405 problem+json with Allow header', async () => {
  for (const method of ['DELETE', 'PATCH', 'PUT']) {
    const res = await call(method, '/api/spec');
    assert.equal(res.statusCode, 405, `${method} /api/spec`);
    assert.match(header(res, 'content-type'), /application\/problem\+json/);
    assert.equal(header(res, 'allow'), 'GET, HEAD, OPTIONS');
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'METHOD_NOT_ALLOWED');
    assert.equal(body.status, 405);
    assert.match(body.type, /\/problems\/method-not-allowed$/);
    assert.ok(!body.version, 'must NOT leak the spec payload on a wrong verb');
  }
});

test('#538: wrong verbs on /api/compute -> 405, Allow lists POST (batch)', async () => {
  const res = await call('DELETE', '/api/compute');
  assert.equal(res.statusCode, 405);
  assert.equal(header(res, 'allow'), 'GET, HEAD, POST, OPTIONS');
  assert.equal(JSON.parse(res.body).code, 'METHOD_NOT_ALLOWED');
});

test('#538: documented verbs still reach the handlers', async () => {
  const specGet = await call('GET', '/api/spec');
  assert.equal(specGet.statusCode, 200);
  assert.ok(specGet.body.includes('openapi'), 'spec payload present');

  const computeGet = await call('GET', '/api/compute');
  assert.equal(computeGet.statusCode, 200);

  // HEAD/OPTIONS stay allowed (OPTIONS preserves the CORS preflight contract).
  const headRes = await call('HEAD', '/api/spec');
  assert.equal(headRes.statusCode, 200);
  // Central OPTIONS handling (#906, merged later) answers 204 No Content
  // with an Allow header before dispatch — supersedes the 200-with-payload
  // this PR originally expected.
  const optRes = await call('OPTIONS', '/api/spec');
  assert.equal(optRes.statusCode, 204);
  assert.ok(optRes.headers.allow || optRes.headers['Allow'], 'Allow header present');
});
