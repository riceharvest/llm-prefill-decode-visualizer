// Agent index integrity (public/api/agent/index.json).
//
// The index must list every agent-facing route registered in the catch-all
// router api/[...path].js AND every route in the central route table
// api/_route_table.js, and every listed path must actually exist there.
//
// Coverage note (#887): GET /api/og IS indexed even though it returns
// image/png rather than JSON — it is a working agent-callable surface, so the
// entry declares its binary response instead of being silently omitted (the
// old exclusion contradicted the index's own "every endpoint" claim).
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
const EXCLUDED = new Set([]);

// Transport shims (issues #372 #373 #376 #381): vercel.json rewrites
// multi-segment paths (/api/calc/<id>, /api/watch/rss.xml, /api/watch/dispatch,
// /api/agent/*.json) to these single-segment aliases because the platform edge
// never routes nested /api/* paths to the function. The canonical paths are
// already indexed; the aliases are the same surface, not new endpoints.
EXCLUDED.add('/calc-replay');
EXCLUDED.add('/watch-rss');
EXCLUDED.add('/watch-dispatch');
EXCLUDED.add('/agent-json');

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

// ---------------------------------------------------------------------------
// Drift + cross-reference guards added for #887/#888 (see below).
// ---------------------------------------------------------------------------

import { flattenRoutes } from './_route_table.js';

const root = path.join(here, '..');
const agents = JSON.parse(readFileSync(path.join(root, 'public', 'agents.json'), 'utf8'));

test('agent index: endpoint set matches the route table exactly (no drift)', () => {
  // index.json spells dynamic segments as {id}; the route table uses :id.
  const norm = (p) => p.replace(/\{([^}]+)\}/g, ':$1');
  const table = new Set(flattenRoutes().map((e) => `${e.method} ${norm(e.path)}`));
  const indexed = new Set(index.endpoints.map((e) => `${e.method} ${norm(e.path)}`));

  const missingFromIndex = [...table].filter((k) => !indexed.has(k));
  assert.deepEqual(
    missingFromIndex,
    [],
    `route-table routes missing from public/api/agent/index.json: ${missingFromIndex.join(', ')}`,
  );

  const staleInIndex = [...indexed].filter((k) => !table.has(k));
  assert.deepEqual(
    staleInIndex,
    [],
    `index.json lists routes absent from api/_route_table.js: ${staleInIndex.join(', ')}`,
  );
});

test('agent index: covers the working non-JSON/GET-only surfaces (#887 defect 1)', () => {
  const pairs = new Set(index.endpoints.map((e) => `${e.method} ${e.path}`));
  for (const key of ['GET /api/og', 'GET /api/mcp', 'POST /api/mcp', 'POST /api/agent/compute.json']) {
    assert.ok(pairs.has(key), `index.json must list ${key}`);
  }
  const og = index.endpoints.find((e) => e.method === 'GET' && e.path === '/api/og');
  assert.match(og.responseSchema, /image\/png/, '/api/og entry must declare its PNG response');
});

test('agent index: cross-references agents.json and vice versa (#887 defect 3)', () => {
  assert.equal(
    index.agentsManifest,
    '/agents.json',
    'index.json must point at its sibling generated manifest',
  );
  assert.equal(
    agents.endpointIndex,
    '/api/agent/index.json',
    'agents.json must point back at the per-endpoint index',
  );
});

test('agent index: description no longer falsely claims every endpoint returns JSON', () => {
  assert.match(index.description, /\/api\/og.*PNG/s, 'description must except the PNG surface');
});
