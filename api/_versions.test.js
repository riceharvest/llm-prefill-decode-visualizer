// Tests for version discovery + deprecation wiring (issues #685, #700).
//
// Covers:
//   1. GET /api/versions — machine-readable enumeration of served prefixes.
//   2. applyVersionTrustHeaders — central middleware that stamps
//      Deprecation/Sunset when a prefix is marked deprecated (the wiring
//      applyDeprecationHeaders() was missing before #685).
//   3. Spelling guard — no response body may carry BOTH `schemaVersion` and
//      `schema_version` (#700 class of bug).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import versionsHandler from './_handlers/versions.js';
import { API_VERSIONS, applyVersionTrustHeaders, prefixForPath, versionForPath } from './_versions.js';
import { SCHEMA_VERSION } from './_schema.js';

function mockRes() {
  const headers = new Map();
  let statusCode = 200;
  let endedBody = null;
  return {
    get headers() { return Object.fromEntries(headers); },
    get endedBody() { return endedBody; },
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    setHeader(k, v) { headers.set(String(k).toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    hasHeader(k) { return headers.has(String(k).toLowerCase()); },
    end(body) { endedBody = body ?? ''; }
  };
}

test('GET /api/versions enumerates every served prefix with its wire schema_version', () => {
  const res = mockRes();
  versionsHandler({}, res);
  const body = JSON.parse(res.endedBody);
  assert.equal(res.statusCode, 200);

  const prefixes = body.versions.map((v) => v.prefix).sort();
  assert.deepEqual(prefixes, ['/api', '/v1'], 'both served prefixes are listed');
  assert.equal(body.current, '/api');

  for (const v of body.versions) {
    assert.equal(v.schema_version, SCHEMA_VERSION, `${v.prefix} reports its wire schema_version`);
    assert.equal(v.status, 'current', `${v.prefix} starts as current`);
    assert.equal(v.sunset, null, `${v.prefix} has no sunset while current`);
    assert.ok(typeof v.canonical === 'boolean');
  }
  const api = body.versions.find((v) => v.prefix === '/api');
  assert.equal(api.canonical, true, '/api is the canonical docs prefix');

  // The universal stamp is present exactly once per spelling rules.
  assert.equal(body.schema_version, SCHEMA_VERSION);
  assert.equal(body.schemaVersion, undefined, '#700: never both spellings in one body');
});

test('prefixForPath / versionForPath resolve /v1/* to the /v1 registry entry', () => {
  assert.equal(prefixForPath('/v1/compute'), '/v1');
  assert.equal(prefixForPath('/v1'), '/v1');
  assert.equal(prefixForPath('/version'), '/api');
  assert.equal(prefixForPath('/anything'), '/api');
  assert.equal(versionForPath('/v1/compute').prefix, '/v1');
});

test('applyVersionTrustHeaders is a no-op while every prefix is current', () => {
  const res = mockRes();
  applyVersionTrustHeaders({}, res, '/v1/compute');
  assert.equal(res.hasHeader('Deprecation'), false);
  assert.equal(res.hasHeader('Sunset'), false);
});

test('applyVersionTrustHeaders stamps Deprecation/Sunset/Link once a prefix flips to deprecated', () => {
  const entry = API_VERSIONS.find((v) => v.prefix === '/v1');
  const prev = { ...entry };
  try {
    entry.status = 'deprecated';
    entry.deprecatedAt = '2026-08-24T00:00:00.000Z';
    entry.sunset = '2026-11-22T00:00:00.000Z'; // ≥90 days later

    const res = mockRes();
    applyVersionTrustHeaders({}, res, '/v1/compute');
    assert.match(res.headers['deprecation'], /^@\d+$/);
    assert.ok(!Number.isNaN(Date.parse(res.headers['sunset'])));
    assert.match(res.headers['link'], /rel="deprecation"/);

    // The canonical prefix stays untouched by the same middleware call path.
    const apiRes = mockRes();
    applyVersionTrustHeaders({}, apiRes, '/version');
    assert.equal(apiRes.hasHeader('Deprecation'), false, 'only the deprecated prefix gets stamped');
  } finally {
    Object.assign(entry, prev);
  }
});
