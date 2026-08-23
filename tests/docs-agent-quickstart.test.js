/**
 * Existence test for docs/AGENT-QUICKSTART.md.
 *
 * Extracts every example endpoint URL mentioned in the agent quickstart doc
 * and asserts each one actually exists as a handler/route in
 * api/[...path].js (the single catch-all dispatcher behind /api/*).
 * Static discovery files referenced from the doc root (e.g. /llms.txt,
 * /agents.json) are verified to exist as files under public/.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docPath = join(root, 'docs', 'AGENT-QUICKSTART.md');
const dispatcherPath = join(root, 'api', '[...path].js');

const BASE_HOST = 'https://llm-prefill-decode-visualizer.vercel.app';
// Regex-escaped host, computed once outside any template literal so the
// character class can safely contain `$` and `{}`.
const HOST = BASE_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Routes served by api/[...path].js: `case '/x'` labels plus /calc/<id>. */
function extractDispatcherRoutes() {
  const src = readFileSync(dispatcherPath, 'utf8');
  const routes = new Set();
  for (const m of src.matchAll(/case\s+'([^']+)'\s*:/g)) {
    routes.add(m[1].replace(/\/$/, ''));
  }
  // Parametric fallback matched via inline regex, e.g. /^\/calc\/([^/]+)$/
  const unescaped = src.replaceAll('\\/', '/');
  for (const m of unescaped.matchAll(/\/([a-z_]+)\/\(\[\^\/\]\+\)/g)) {
    routes.add(`/${m[1]}/:id`);
  }
  return routes;
}

/**
 * Pull every example API path out of the quickstart markdown.
 * Matches fenced/inline-code paths like /api/compute?... and absolute URLs on
 * the production host. Query strings are dropped; results are normalized to
 * dispatcher space ('/api/' and '/v1/' prefixes stripped).
 */
function extractDocPaths(doc) {
  const patterns = [
    new RegExp(HOST + '(/api/[^\\s)`\'"]+)', 'g'),
    /(?<![\w/])(\/api\/[a-zA-Z0-9_./<>:-]*)/g
  ];
  const found = new Set();
  for (const re of patterns) {
    for (const m of doc.matchAll(re)) {
      let p = m[1];
      // Strip trailing punctuation markdown/code fencing can leave behind
      // when the match wasn't wrapped in backticks.
      p = p.replace(/[.,;)]+$/, '');
      found.add(p);
    }
  }
  // Normalize: drop query strings, strip /api/ and /v1/ prefixes.
  const normalized = new Set();
  for (const p of found) {
    let route = p.split('?')[0];
    // Strip prefixes in either order: /api/x, /v1/x and /api/v1/x are all
    // equivalent at the dispatcher.
    route = route.replace(/^\/(api|v1)\//, '/');
    route = route.replace(/^\/(api|v1)\//, '/');
    normalized.add(route);
  }
  return [...normalized].sort();
}

test('agent quickstart doc exists', () => {
  assert.ok(existsSync(docPath), 'docs/AGENT-QUICKSTART.md is missing');
});

test('quickstart mentions at least a handful of example endpoints', () => {
  const doc = readFileSync(docPath, 'utf8');
  const paths = extractDocPaths(doc);
  assert.ok(
    paths.length >= 8,
    `expected >= 8 example endpoints in the quickstart, found ${paths.length}: ${paths.join(', ')}`
  );
});

test('every example endpoint URL in the quickstart exists as an API route', () => {
  const doc = readFileSync(docPath, 'utf8');
  const paths = extractDocPaths(doc);
  const routes = extractDispatcherRoutes();
  assert.ok(routes.size > 0, 'failed to extract any routes from api/[...path].js');

  for (const p of paths) {
    if (p.endsWith('/:id') || /\/<[a-z]+>$/.test(p)) {
      // Parametric example like /api/calc/<id> → dispatcher route /calc/:id
      const paramRoute = p.replace(/\/<[a-z]+>$/, '/:id');
      assert.ok(
        routes.has(paramRoute),
        `quickstart references ${p} but dispatcher has no ${paramRoute} route (known: ${[...routes].sort().join(', ')})`
      );
    } else {
      assert.ok(
        routes.has(p),
        `quickstart references ${p} but no such route exists in api/[...path].js (known: ${[...routes].sort().join(', ')})`
      );
    }
  }
});

test('static discovery files referenced from the quickstart exist under public/', () => {
  const doc = readFileSync(docPath, 'utf8');
  const re = new RegExp(HOST + '/(?!api/)([a-zA-Z0-9_.-]+)', 'g');
  for (const m of doc.matchAll(re)) {
    const file = join(root, 'public', m[1]);
    assert.ok(existsSync(file), `quickstart references ${BASE_HOST}/${m[1]} but public/${m[1]} does not exist`);
  }
});
