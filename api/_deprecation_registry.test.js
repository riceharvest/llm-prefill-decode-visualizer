// #714 — deprecation-header wiring end-to-end.
//
// applyDeprecationHeaders() existed but had zero production call sites while
// every response advertised 'Deprecation, Sunset' via
// Access-Control-Expose-Headers. The dispatcher now consults
// DEPRECATION_REGISTRY on every /api/* request: registering a route activates
// the documented Deprecation/Sunset/Link contract for it immediately.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import apiHandler from '../api/[...path].js';
import {
  DEPRECATION_REGISTRY,
  registerDeprecatedRoute,
  unregisterDeprecatedRoute,
  applyDeprecationForPath
} from '../api/_schema.js';

function makeRes() {
  const captured = {};
  return {
    captured,
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    end(body) {
      captured.status = this.statusCode;
      captured.rawBody = body ?? '';
    }
  };
}

test('registry starts empty — no route ships deprecation headers today', () => {
  assert.equal(Object.keys(DEPRECATION_REGISTRY).length, 0);
});

test('registering a route makes the dispatcher emit Deprecation/Sunset/Link (#714)', async t => {
  const route = '/version';
  registerDeprecatedRoute(route, {
    deprecatedAt: '2026-08-01T00:00:00Z',
    sunset: '2026-12-01T00:00:00Z',
    link: '/CHANGELOG-API.md'
  });
  t.after(() => unregisterDeprecatedRoute(route));

  const res = makeRes();
  await apiHandler({ url: '/api/version', query: {}, headers: { 'x-forwarded-for': 'dep-test' } }, res);

  assert.equal(res.captured.status, 200);
  assert.match(res.headers['Deprecation'], /^@\d+$/, 'Deprecation must be @<unix-seconds>');
  const sunset = new Date(res.headers['Sunset']);
  assert.ok(!Number.isNaN(sunset.getTime()), 'Sunset must be an HTTP-date');
  assert.match(res.headers['Link'] || '', /rel="deprecation"/);
  // The exposed-headers advertisement must cover both custom headers so
  // browser agents can actually read them.
  const expose = String(res.headers['Access-Control-Expose-Headers']);
  assert.ok(expose.includes('Deprecation') && expose.includes('Sunset'));
});

test('unregistered routes carry no deprecation headers', async t => {
  const route = '/version';
  registerDeprecatedRoute(route, { sunset: '2026-12-01T00:00:00Z', link: '/CHANGELOG-API.md' });
  unregisterDeprecatedRoute(route);

  const res = makeRes();
  await apiHandler({ url: '/api/version', query: {}, headers: { 'x-forwarded-for': 'dep-test' } }, res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.headers['Deprecation'], undefined);
  assert.equal(res.headers['Sunset'], undefined);
});

test('/v1/ alias of a registered route is covered too', () => {
  registerDeprecatedRoute('/health', { sunset: '2026-12-01T00:00:00Z' });
  const res = makeRes();
  try {
    assert.equal(applyDeprecationForPath(res, '/health'), true);
    assert.match(res.headers['Deprecation'], /^@\d+$/);
  } finally {
    unregisterDeprecatedRoute('/health');
  }
});
