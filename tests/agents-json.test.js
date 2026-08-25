// Parse/consistency test for public/agents.json — the agent-facing capability
// manifest. Asserts the file is valid JSON, every endpoint entry carries the
// required fields, and every advertised path actually exists as a route in
// api/[...path].js (the single catch-all dispatcher behind /api/*).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'public', 'agents.json');
const dispatcherPath = join(root, 'api', '[...path].js');

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function loadManifest() {
  const raw = readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw); // throws (and fails the test) on invalid JSON
}

/**
 * Extract the concrete routes the dispatcher serves, by reading
 * api/[...path].js source: `case '/x'` labels plus the /calc/<id> regex.
 * Returns a Set of normalized route strings like '/compute' and '/calc/:id'.
 */
function extractDispatcherRoutes() {
  const src = readFileSync(dispatcherPath, 'utf8');
  const routes = new Set();
  for (const m of src.matchAll(/case\s+'([^']+)'\s*:/g)) {
    routes.add(m[1].replace(/\/$/, ''));
  }
  // Parametric fallback route matched via inline regex in the dispatcher,
  // e.g. clean.match(/^\/calc\/([^/]+)$/) — normalize to "/calc/:id".
  const unescaped = src.replaceAll('\\/', '/');
  for (const m of unescaped.matchAll(/\/([a-z_]+)\/\(\[\^\/\]\+\)/g)) {
    routes.add(`/${m[1]}/:id`);
  }
  return routes;
}

test('agents.json is present and parses as valid JSON', () => {
  const manifest = loadManifest();
  assert.equal(typeof manifest, 'object');
  assert.ok(!Array.isArray(manifest));
});

test('agents.json carries required top-level metadata', () => {
  const manifest = loadManifest();
  for (const field of ['name', 'description', 'url', 'endpoints']) {
    assert.ok(manifest[field], `missing top-level field: ${field}`);
  }
  assert.ok(Array.isArray(manifest.endpoints) && manifest.endpoints.length > 0);
});

test('every endpoint entry has required fields with sane values', () => {
  const { endpoints } = loadManifest();
  for (const [i, ep] of endpoints.entries()) {
    for (const field of ['path', 'method', 'description', 'returns']) {
      assert.ok(
        typeof ep[field] === 'string' && ep[field].length > 0,
        `endpoint[${i}] (${ep.path ?? '?'}): missing or empty "${field}"`
      );
    }
    assert.ok(ep.path.startsWith('/'), `endpoint[${i}]: path must be absolute (${ep.path})`);
    assert.ok(
      VALID_METHODS.has(ep.method.toUpperCase()),
      `endpoint[${i}]: unknown HTTP method "${ep.method}"`
    );
  }
});

test('no duplicate (method, path) pairs', () => {
  const { endpoints } = loadManifest();
  const seen = new Set();
  for (const ep of endpoints) {
    const key = `${ep.method.toUpperCase()} ${ep.path}`;
    assert.ok(!seen.has(key), `duplicate endpoint entry: ${key}`);
    seen.add(key);
  }
});

test('every advertised endpoint path exists as a route in the API dispatcher', () => {
  const { endpoints } = loadManifest();
  const routes = extractDispatcherRoutes();
  assert.ok(routes.size > 0, 'failed to extract any routes from api/[...path].js');

  for (const ep of endpoints) {
    // Manifest paths are public (/api/...) — normalize to dispatcher space.
    let route = ep.path.replace(/^\/(api|v1)\//, '/');
    route = route.replace(/\/:id$/, '/:id'); // already normalized form

    const concrete = route.endsWith('/:id')
      ? null
      : route.replace(/\/$/, '');

    if (route === '/calc/:id') {
      assert.ok(routes.has('/calc/:id'), `manifest advertises ${ep.path} but dispatcher has no /calc/<id> route`);
    } else if (route === '/runs/:id') {
      assert.ok(routes.has('/runs/:id'), `manifest advertises ${ep.path} but dispatcher has no /runs/<id> route`);
    } else if (!routes.has(concrete)) {
      assert.fail(
        `manifest advertises ${ep.method} ${ep.path} but no such route exists in api/[...path].js ` +
        `(known: ${[...routes].sort().join(', ')})`
      );
    }
  }
});
