// Tests for GET /api/version — the machine-readable version report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import handler from './_handlers/version.js';
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
  assert.match(body.version, /^[\w.-]+$/); // package.json semver-ish or 'unknown'
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

test('reported app version matches package.json (or unknown fallback)', () => {
  const res = mockRes();
  handler({}, res);
  const body = JSON.parse(res.endedBody);
  let expected = 'unknown';
  try {
    expected = JSON.parse(readFileSync(`${repoRoot}package.json`, 'utf8')).version;
  } catch { /* keep fallback */ }
  assert.equal(body.version, expected ?? 'unknown');
});
