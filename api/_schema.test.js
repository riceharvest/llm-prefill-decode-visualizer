import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  withSchemaVersion,
  applySchemaHeaders,
  applyDeprecationHeaders,
  sendJson
} from './_schema.js';

/** Minimal mock of the Vercel/Node ServerResponse surface these helpers use. */
function mockRes() {
  const headers = new Map();
  let statusCode = 200;
  let endedBody = null;
  return {
    get headers() { return Object.fromEntries(headers); },
    get endedBody() { return endedBody; },
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    setHeader(k, v) { headers.set(k.toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    end(body) { endedBody = body ?? ''; }
  };
}

test('SCHEMA_VERSION is the current major version string', () => {
  assert.equal(SCHEMA_VERSION, '1');
});

test('withSchemaVersion stamps schema_version first and preserves payload', () => {
  const out = withSchemaVersion({ results: [1, 2, 3], matchedRuns: 42 });
  assert.equal(out.schema_version, '1');
  assert.deepEqual(out.results, [1, 2, 3]);
  assert.equal(out.matchedRuns, 42);
});

test('withSchemaVersion does not mutate or overwrite an existing version', () => {
  const body = { schema_version: '9' };
  const out = withSchemaVersion(body);
  assert.equal(out.schema_version, '1'); // current policy: sender always wins
  assert.equal(body.schema_version, '9'); // input untouched
  assert.deepEqual(withSchemaVersion({}), { schema_version: '1' });
});

test('applySchemaHeaders sets X-Schema-Version and CORS exposure', () => {
  const res = mockRes();
  applySchemaHeaders(res);
  assert.equal(res.headers['x-schema-version'], '1');
  const expose = res.headers['access-control-expose-headers'];
  for (const h of ['X-Schema-Version', 'Deprecation', 'Sunset']) {
    assert.ok(expose.includes(h), `exposes ${h}`);
  }
});

test('applySchemaHeaders merges with pre-existing exposed headers', () => {
  const res = mockRes();
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
  applySchemaHeaders(res);
  const expose = res.headers['access-control-expose-headers'];
  assert.ok(expose.includes('X-Request-Id'));
  assert.ok(expose.includes('X-Schema-Version'));
});

test('sendJson sets status, content type, cache header and stamped body', () => {
  const res = mockRes();
  sendJson(res, { hello: 'world' }, { status: 201, cacheTtl: 60 });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'public, max-age=60');
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.equal(res.headers['x-schema-version'], '1');
  const parsed = JSON.parse(res.endedBody);
  assert.equal(parsed.schema_version, '1');
  assert.equal(parsed.hello, 'world');
});

test('sendJson stamps error payloads too (schema_version on errors)', () => {
  const res = mockRes();
  sendJson(res, { error: 'boom' }, { status: 502 });
  const parsed = JSON.parse(res.endedBody);
  assert.equal(res.statusCode, 502);
  assert.equal(parsed.schema_version, '1');
  assert.equal(parsed.error, 'boom');
});

test('sendJson omits Cache-Control when no ttl given and respects preset headers', () => {
  const res = mockRes();
  sendJson(res, { ok: true });
  assert.ok(!('cache-control' in res.headers));

  const res2 = mockRes();
  res2.setHeader('Cache-Control', 'no-store');
  sendJson(res2, { ok: true }, { cacheTtl: 600 });
  assert.equal(res2.headers['cache-control'], 'no-store');
});

test('applyDeprecationHeaders emits Deprecation, Sunset and Link', () => {
  const res = mockRes();
  applyDeprecationHeaders(res, {
    deprecatedAt: '2026-08-21T00:00:00Z',
    sunset: '2026-11-19T00:00:00Z',
    link: '/CHANGELOG-API.md#v0-to-v1'
  });
  // Deprecation: @<unix seconds of announcement>
  const expectedAnnounced = Math.floor(Date.parse('2026-08-21T00:00:00Z') / 1000);
  assert.equal(res.headers['deprecation'], `@${expectedAnnounced}`);
  assert.equal(
    res.headers['sunset'],
    new Date('2026-11-19T00:00:00Z').toUTCString()
  );
  assert.match(res.headers['link'], /^<\/CHANGELOG-API\.md#v0-to-v1>; rel="deprecation"$/);
  // Deprecation responses still advertise the schema version.
  assert.equal(res.headers['x-schema-version'], '1');
});

test('applyDeprecationHeaders tolerates missing optional fields', () => {
  const res = mockRes();
  applyDeprecationHeaders(res, {}); // no dates at all — must not throw
  // deprecatedAt defaults to "now", so Deprecation is still announced.
  const announced = Math.floor(Number(res.headers['deprecation'].slice(1)) * 1000);
  assert.ok(Math.abs(Date.now() - announced) < 60_000, 'Deprecation ≈ now');
  assert.ok(!('sunset' in res.headers));
  assert.ok(!('link' in res.headers));
});
