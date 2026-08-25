// Tests for GET /api/version — the machine-readable version report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import handler, { resolveAppVersion } from './_handlers/version.js';
import { SCHEMA_VERSION } from './_schema.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Minimal mock of the Vercel/Node ServerResponse surface sendJson uses. */
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
    end(body) { endedBody = body ?? ''; }
  };
}

test('GET /api/version returns 200 with service, version', () => {
  const res = mockRes();
  handler({}, res);
  const body = JSON.parse(res.endedBody);
  assert.equal(res.statusCode, 200);
  assert.equal(body.service, 'llm-prefill-decode-visualizer');
  assert.match(body.version, /^[\w.-]+$/); // resolved semver-ish or 'unknown'
  // #700 (merged later) standardized on ONE snake_case spelling.
  assert.equal(body.schema_version, SCHEMA_VERSION);
  assert.ok(!Number.isNaN(Date.parse(body.generatedAt)), 'generatedAt is ISO');
});

test('/api/version carries the standard schema_version stamp + header', () => {
  const res = mockRes();
  handler({}, res);
  const body = JSON.parse(res.endedBody);
  assert.equal(body.schema_version, SCHEMA_VERSION);
  assert.equal(res.headers['x-schema-version'], SCHEMA_VERSION);
});

test('#700: /api/version reports exactly ONE spelling of the schema field', () => {
  const res = mockRes();
  handler({}, res);
  const body = JSON.parse(res.endedBody);
  assert.equal(body.schema_version, SCHEMA_VERSION);
  // The camelCase alias was the whole bug — it must stay gone.
  assert.equal(body.schemaVersion, undefined, 'camelCase schemaVersion must not reappear alongside schema_version');
});

test('/api/version links to spec and both changelog surfaces', () => {
  const res = mockRes();
  handler({}, res);
  const { links } = JSON.parse(res.endedBody);
  assert.equal(links.spec, '/api/spec');
  assert.equal(links.changelogMarkdown, '/CHANGELOG-API.md');
  assert.equal(links.changelogJson, '/CHANGELOG.json');
});

test('reported app version matches package.json — or the clients/VERSION fallback when package.json is a placeholder (#575)', () => {
  const res = mockRes();
  handler({}, res);
  const body = JSON.parse(res.endedBody);
  let pkgVersion = null;
  try {
    pkgVersion = JSON.parse(readFileSync(`${repoRoot}package.json`, 'utf8')).version;
  } catch { /* keep null */ }
  if (pkgVersion && pkgVersion !== '0.0.0') {
    assert.equal(body.version, pkgVersion);
    assert.equal(body.packageVersion, undefined, 'no packageVersion echo when it equals version');
  } else {
    // Placeholder/unreadable package.json: fall back to the API release
    // version so the endpoint never reports a useless 0.0.0.
    let expected = 'unknown';
    try {
      // The handler takes the FIRST LINE of clients/VERSION (the file also
      // carries generator-tool annotation lines that are not a version).
      expected = readFileSync(`${repoRoot}clients/VERSION`, 'utf8').split('\n')[0].trim() || 'unknown';
    } catch { /* keep fallback */ }
    assert.equal(body.version, expected);
    if (pkgVersion) assert.equal(body.packageVersion, pkgVersion, 'raw package.json field echoed as packageVersion');
  }
});

test('resolveAppVersion prefers package.json when it is a real version', () => {
  const { version, packageVersion } = resolveAppVersion();
  assert.ok(version, 'version always resolves');
  if (packageVersion && packageVersion !== '0.0.0') {
    assert.equal(version, packageVersion);
  }
});

test('resolveAppVersion falls back past placeholder package versions', () => {
  // Fake repo root with a placeholder package.json and no clients/VERSION:
  // version must degrade to 'unknown' rather than '0.0.0'.
  const fakeRoot = { href: 'file:///nonexistent-repo/' };
  const { version, packageVersion } = resolveAppVersion(fakeRoot);
  assert.equal(version, 'unknown');
  assert.equal(packageVersion, null);
});
