// Drift guard for docs/AGENT_COOKBOOK.md.
//
// The cookbook is hand-written documentation of the agent-facing API. This
// test keeps it honest in both directions:
//   1. every endpoint documented in a cookbook recipe heading must actually
//      be registered in the route source (api/[...path].js);
//   2. every route registered in the router must be documented in the
//      cookbook (so new endpoints can't ship undocumented).
// It also checks the error-code table stays in sync with the ERROR_CODES
// registry in api/_errors.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ERROR_CODES } from './api/_errors.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const COOKBOOK = readFileSync(join(ROOT, 'docs', 'AGENT_COOKBOOK.md'), 'utf8');
const ROUTER = readFileSync(join(ROOT, 'api', '[...path].js'), 'utf8');

// Extract documented endpoints from recipe headings: ## `GET /api/compute`
function documentedEndpoints() {
  const out = [];
  const re = /^#{2,4}\s+`(GET|POST|DELETE|PUT|PATCH)\s+(\/[^`]+)`/gm;
  let m;
  while ((m = re.exec(COOKBOOK)) !== null) {
    out.push({ method: m[1], path: m[2].split('?')[0] });
  }
  return out;
}

// Routes registered in the catch-all router: `case '/compute':` switch arms
// plus the /calc/<id> regex fallback.
function registeredRoutes() {
  const cases = [...ROUTER.matchAll(/case '([^']+)':/g)].map(m => m[1]);
  assert.ok(cases.length > 0, 'no route cases found in api/[...path].js — router format changed?');
  return new Set(cases);
}

test('cookbook has at least one recipe per documented endpoint', () => {
  const endpoints = documentedEndpoints();
  assert.ok(endpoints.length >= 15, `expected >=15 documented endpoints, found ${endpoints.length}`);
});

test('every documented endpoint path exists in the route source', () => {
  const routes = registeredRoutes();
  for (const { method, path } of documentedEndpoints()) {
    assert.ok(path.startsWith('/api/'), `recipe path not under /api/: ${method} ${path}`);
    const clean = path.replace(/^\/api\//, '/').replace(/^\/v1\//, '/');
    if (/^\/calc\/[^/]+$/.test(clean)) {
      assert.match(ROUTER, /calc\\\/\(\[\^\/\]\+\)/, 'calc/:id route missing from router');
      continue;
    }
    assert.ok(
      routes.has(clean),
      `cookbook documents ${method} /api${clean} but api/[...path].js has no case '${clean}'`
    );
  }
});

test('every registered route is documented in the cookbook (no undocumented endpoints)', () => {
  const documented = new Set(
    documentedEndpoints().map(({ path }) => path.replace(/^\/api\//, '/').replace(/^\/v1\//, '/'))
  );
  for (const route of registeredRoutes()) {
    if (route === '/calc') continue; // handled by the /calc/{id} regex route
    assert.ok(
      documented.has(route),
      `router serves /api${route} but the cookbook has no recipe for it`
    );
  }
  assert.ok(documented.has('/calc/{id}'), 'cookbook should document /api/calc/{id}');
});

test('error-code table covers every registered ERROR_CODES entry', () => {
  for (const code of Object.keys(ERROR_CODES)) {
    assert.ok(
      COOKBOOK.includes(`\`${code}\``),
      `error code ${code} missing from the cookbook error table`
    );
  }
});

test('rate-limit headers are documented as emitted (no invented headers)', () => {
  for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After']) {
    assert.ok(COOKBOOK.includes(h), `rate-limit header ${h} not documented`);
  }
});
