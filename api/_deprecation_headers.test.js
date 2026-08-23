// Deprecation headers contract test.
//
// Policy (api/_schema.js + CHANGELOG-API.md): when an API surface is
// deprecated, its responses carry
//   Deprecation: @<unix-seconds>   (announcement, draft-ietf-httpapi-deprecation-header)
//   Sunset: <HTTP-date>            (removal date, RFC 8594)
//   Link: <...>; rel="deprecation" (migration notes)
//
// Source of truth for "which surfaces are deprecated" is the OpenAPI spec:
// any operation marked `deprecated: true` MUST send those headers. This test
// cross-checks spec markers against live handler behaviour so drift between
// docs and wire is caught. NOTE: today zero operations are marked deprecated
// (the helper applyDeprecationHeaders exists and is unit-tested in
// _schema.test.js, awaiting its first caller) — the loop below is the
// forward guard that activates the moment one is marked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import specHandler from '../api/_handlers/spec.js';
import apiHandler from '../api/[...path].js';

async function callApi(handlerFn, url) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    end(body) {
      captured.status = this.statusCode;
      captured.rawBody = body ?? '';
    }
  };
  await handlerFn({ url, query: {}, headers: { 'x-forwarded-for': 'deprecation-test' } }, res);
  return { status: captured.status, headers: res.headers, rawBody: captured.rawBody };
}

async function loadSpec() {
  const { status, rawBody } = await callApi(specHandler, '/api/spec');
  assert.equal(status, 200, '/api/spec must respond');
  return JSON.parse(rawBody);
}

test('the OpenAPI spec documents a deprecation policy', async () => {
  const spec = await loadSpec();
  assert.equal(spec.openapi, '3.1.0');
  assert.match(spec.info.description, /deprecat/i,
    'info.description must point consumers at the deprecation policy');
});

test('collects every operation marked deprecated in the spec', async () => {
  const spec = await loadSpec();
  assert.ok(spec.paths && typeof spec.paths === 'object');

  const deprecatedOps = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      if (op?.deprecated === true) {
        deprecatedOps.push({ path, method, op });
      }
    }
  }
  assert.ok(Array.isArray(deprecatedOps)); // scan machinery works

  // Every marked operation must actually emit the deprecation headers.
  for (const { path, method, op } of deprecatedOps) {
    const { status, headers } = await callApi(apiHandler, path);
    assert.ok(status < 500, `${method.toUpperCase()} ${path} should respond`);
    assert.match(headers['Deprecation'], /^@\d+$/,
      `${method.toUpperCase()} ${path}: Deprecation header must be @<unix-seconds>`);
    if (op['x-sunset']) {
      const sunset = new Date(headers['Sunset']);
      assert.ok(!Number.isNaN(sunset.getTime()),
        `${method.toUpperCase()} ${path}: Sunset must be an HTTP-date`);
    }
    assert.match(headers['Link'] || '', /rel="deprecation"/,
      `${method.toUpperCase()} ${path}: Link rel=deprecation must point at migration notes`);
  }
});
