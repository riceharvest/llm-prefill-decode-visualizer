// Agent index integrity (public/api/agent/index.json).
//
// The index must list every agent-facing route registered in the catch-all
// router api/[...path].js, and every listed path must actually exist there.
//
// Excluded from the index (non-agent routes), with reasons:
//   /api/og  — server-rendered PNG social-card image generator; not a
//              machine-readable JSON/XML API for agents.
// Everything else registered in the router is agent-facing and listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const index = JSON.parse(readFileSync(path.join(here, '..', 'public', 'api', 'agent', 'index.json'), 'utf8'));
const routerSource = readFileSync(path.join(here, '[...path].js'), 'utf8');

// Routes discovered from the router source: `case '/x':` literals plus the
// dynamic /calc/:id regex fallback.
function discoverRoutes() {
  const routes = new Set();
  for (const m of routerSource.matchAll(/case '(\/[^']+)':/g)) {
    routes.add(m[1]);
  }
  if (routerSource.includes("clean.match(/^\\/calc\\/")) {
    routes.add('/calc/:id');
  }
  return routes;
}

// Non-agent exclusions — keep in sync with the comment above.
const EXCLUDED = new Set(['/og']);

test('agent index: every endpoint maps to a real route in api/[...path].js', () => {
  assert.ok(Array.isArray(index.endpoints) && index.endpoints.length > 0);
  const routes = discoverRoutes();
  for (const ep of index.endpoints) {
    assert.equal(typeof ep.method, 'string', `endpoint missing method: ${JSON.stringify(ep)}`);
    assert.equal(typeof ep.description, 'string');
    assert.match(ep.path, /^\/api\//);
    const suffix = '/' + ep.path.replace(/^\/api\//, '').replace('{id}', ':id');
    assert.ok(
      routes.has(suffix),
      `indexed endpoint ${ep.method} ${ep.path} has no matching route '${suffix}' in api/[...path].js`
    );
  }
});

test('agent index: covers all agent-facing routes (count matches registrations minus exclusions)', () => {
  const routes = [...discoverRoutes()];
  const indexedPaths = new Set(index.endpoints.map(e => e.path));
  const expectedAgentRoutes = routes.filter(r => !EXCLUDED.has(r));
  assert.ok(
    indexedPaths.size >= expectedAgentRoutes.length,
    `index lists ${indexedPaths.size} distinct paths but router registers ${expectedAgentRoutes.length} agent routes (${expectedAgentRoutes.join(', ')})`
  );
  // Every non-excluded route is covered by at least one indexed entry.
  for (const r of expectedAgentRoutes) {
    const apiPath = '/api' + r.replace(':id', '{id}');
    assert.ok(
      indexedPaths.has(apiPath),
      `route '${r}' is agent-facing but missing from public/api/agent/index.json`
    );
  }
});

test('agent index: excluded routes are documented and genuinely non-agent', () => {
  const routes = discoverRoutes();
  for (const r of routes) {
    if (!index.endpoints.some(e => e.path === '/api' + r.replace(':id', '{id}'))) {
      assert.ok(EXCLUDED.has(r), `route '${r}' is not indexed and not listed in EXCLUDED`);
    }
  }
});

test('agent index: methods are valid HTTP verbs', () => {
  const VALID = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
  for (const ep of index.endpoints) {
    assert.ok(VALID.has(ep.method.toUpperCase()), `invalid method '${ep.method}' on ${ep.path}`);
  }
});
