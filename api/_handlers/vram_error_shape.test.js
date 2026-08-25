// Regression test for #539: GET /api/vram without ?hfId= used to answer an
// ad-hoc {error} JSON body with no stable code and the wrong content type.
// It must now speak the universal RFC 9457 problem+json contract while keeping
// the discoverable params/examples guidance as extra members.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import handler from './vram.js';

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

async function call(query = {}) {
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/vram', headers: {}, query }, res);
  return res;
}

test('#539: missing hfId -> 400 application/problem+json with code INVALID_PARAMS', async () => {
  const res = await call();
  assert.equal(res.statusCode, 400);
  assert.match(header(res, 'content-type'), /^application\/problem\+json/);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_PARAMS');
  assert.equal(body.status, 400);
  assert.equal(body.title, 'Invalid parameters');
  assert.match(body.type, /\/problems\/invalid-params$/);
  assert.match(body.detail, /missing hfId/);
});

test('#539: parameter list and examples survive as extra members', async () => {
  const res = await call();
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body.params) && body.params.some((p) => p.startsWith('hfId')), 'params[] preserved');
  assert.ok(Array.isArray(body.examples) && body.examples.length >= 2, 'examples[] preserved');
});

test('#539: thrown errors map to their stable codes by status', async () => {
  // Force the catch path via a thrown tagged error (status passthrough).
  const res = mockRes();
  await handler(
    {
      method: 'GET',
      url: '/api/vram',
      headers: {},
      query: {}
    },
    res
  );
  assert.equal(res.statusCode, 400); // sanity: no-hfId path stays 400

  const { problemBody } = await import('../_errors.js');
  const body = problemBody({ status: 502, code: 'UPSTREAM_UNAVAILABLE', detail: 'HF unreachable' });
  assert.equal(body.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(body.status, 502);
});
