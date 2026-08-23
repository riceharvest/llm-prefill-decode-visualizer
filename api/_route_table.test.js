// Drift + contract tests for the generated agents.json capability document.
//
// Guards three things:
//   1. public/agents.json exactly matches what scripts/generate-agents-json.mjs
//      builds from the central route table (api/_route_table.js) — hand edits
//      or un-regenerated route changes fail here.
//   2. The route table covers every route the dispatcher in api/[...path].js
//      actually serves (and vice versa) — a new `case` without a table entry
//      fails here.
//   3. Every per-endpoint `sinceVersion` annotation is present and well-formed
//      (semver x.y.z).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES, flattenRoutes } from './_route_table.js';
import { buildAgentsJson } from '../scripts/generate-agents-json.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('committed agents.json matches the generator output (no drift)', () => {
  const committed = fs.readFileSync(path.join(root, 'public', 'agents.json'), 'utf8');
  const generated = JSON.stringify(buildAgentsJson(), null, 2) + '\n';
  assert.equal(
    committed,
    generated,
    'public/agents.json is stale — run: node scripts/generate-agents-json.mjs'
  );
});

test('every dispatcher case has a route-table entry (and vice versa)', () => {
  const source = fs.readFileSync(path.join(root, 'api', '[...path].js'), 'utf8');

  // Static `case '/x':` dispatch targets.
  const casePaths = [...source.matchAll(/case '(\/[^']*)':/g)].map((m) => m[1]);
  // The dynamic /calc/<id> fallback (regex route, no case label).
  const hasCalcFallback = /clean\.match\(\/\^\\\/calc\\\//.test(source);

  const tableStatic = ROUTES.filter((r) => r.path !== '/calc/:id').map((r) => r.path);
  const tableHasCalc = ROUTES.some((r) => r.path === '/calc/:id');

  const missingFromTable = casePaths.filter((p) => !tableStatic.includes(p));
  assert.deepEqual(
    missingFromTable,
    [],
    `dispatcher serves routes absent from api/_route_table.js: ${missingFromTable.join(', ')}`
  );

  const missingFromDispatcher = tableStatic.filter((p) => !casePaths.includes(p));
  assert.deepEqual(
    missingFromDispatcher,
    [],
    `route table lists routes the dispatcher never serves: ${missingFromDispatcher.join(', ')}`
  );

  assert.ok(hasCalcFallback, 'expected the /calc/<id> regex fallback in the dispatcher');
  assert.ok(tableHasCalc, 'route table must describe the /calc/:id dynamic route');
});

test('every endpoint carries a well-formed sinceVersion annotation', () => {
  for (const route of ROUTES) {
    assert.match(
      route.sinceVersion,
      /^\d+\.\d+\.\d+$/,
      `${route.path}: sinceVersion must be semver x.y.z, got ${JSON.stringify(route.sinceVersion)}`
    );
  }
  const flat = flattenRoutes();
  assert.ok(flat.length >= ROUTES.length, 'flattening must preserve every route');
  for (const entry of flat) {
    assert.ok(entry.description && entry.description.length > 10, `${entry.path}: description required`);
    assert.match(entry.sinceVersion, /^\d+\.\d+\.\d+$/, `${entry.method} ${entry.path}: bad sinceVersion`);
  }
});

test('generated agents.json exposes sinceVersion on every endpoint entry', () => {
  const doc = buildAgentsJson();
  assert.ok(Array.isArray(doc.endpoints) && doc.endpoints.length > 0);
  const expected = new Set(flattenRoutes().map((e) => `${e.method} ${e.path}`));
  for (const ep of doc.endpoints) {
    assert.match(ep.sinceVersion, /^\d+\.\d+\.\d+$/, `${ep.method} ${ep.path}: bad sinceVersion in output`);
    expected.delete(`${ep.method} ${ep.path}`);
  }
  assert.equal(expected.size, 0, 'every flattened route must appear in the generated document');
});
