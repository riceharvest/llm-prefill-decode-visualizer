// Drift guard for the agent capability reference (AGENTS.md, or its draft
// staging location docs/agents-capability-reference-draft.md until user
// consent lands it at the repo root).
//
// Every endpoint, constant, MCP tool and repo-file path cited in the doc must
// exist in the actual source. Run: node --test test/agents-md.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function locateDoc() {
  const candidates = [
    path.join(root, 'AGENTS.md'),
    path.join(root, 'docs', 'agents-capability-reference-draft.md'),
  ];
  const found = candidates.find((p) => existsSync(p));
  assert.ok(found, 'capability reference not found (AGENTS.md or draft)');
  return found;
}

const docPath = locateDoc();
const doc = readFileSync(docPath, 'utf8');
const routerSrc = readFileSync(path.join(root, 'api', '[...path].js'), 'utf8');

/** Extract /api/... paths written as `METHOD /api/x` in the doc. */
function documentedEndpoints() {
  const re = /(?:GET|POST|DELETE)\s+(\/api\/[a-z0-9._\-/:]+)/gi;
  const set = new Set();
  for (const m of doc.matchAll(re)) {
    let p = m[1].split('?')[0];
    // Normalize placeholder segments: /api/calc/<id> -> /api/calc/:param
    p = p.replace(/<[^>]+>/g, ':param');
    // Also normalize concrete example ids: /api/calc/calc_x -> /api/calc/:param
    p = p.replace(/^\/api\/calc\/.+$/, '/api/calc/:param');
    if (p.endsWith('/')) p = p.slice(0, -1);
    set.add(p);
  }
  return [...set].sort();
}

test('capability reference exists and documents itself as source-grounded', () => {
  assert.match(doc, /api\/\[\.\.\.path\]\.js/);
});

test('every documented /api endpoint exists in the route table', () => {
  const endpoints = documentedEndpoints();
  assert.ok(endpoints.length >= 15, `expected a real enumeration, got ${endpoints.length}`);
  for (const ep of endpoints) {
    const sub = ep.slice('/api'.length); // e.g. /compute, /calc/:param
    const ok =
      routerSrc.includes(`'${sub}'`) ||
      new RegExp(sub.replace(':param', '[^/\']+').replace(/\//g, '\\/')).test(routerSrc);
    assert.ok(ok, `endpoint ${ep} not found in api/[...path].js`);
  }
});

test('the route table contains no undocumented /api routes', () => {
  const cases = [...routerSrc.matchAll(/case '(\/[^']+)'/g)].map((m) => '/api' + m[1]);
  const documented = new Set(documentedEndpoints());
  for (const route of cases) {
    assert.ok(
      documented.has(route),
      `route ${route} exists in api/[...path].js but is not documented`
    );
  }
});

test('documented rate limit matches api/_ratelimit.js', () => {
  const rl = readFileSync(path.join(root, 'api', '_ratelimit.js'), 'utf8');
  const codeDefault = rl.match(/RATE_LIMIT_MAX\)\s*\|\|\s*(\d+)/);
  assert.ok(codeDefault, 'RATE_LIMIT default not found in api/_ratelimit.js');
  const claimed = doc.match(/(\d+)\s*req\/min/);
  assert.ok(claimed, 'doc must state an explicit req/min budget');
  assert.equal(Number(claimed[1]), Number(codeDefault[1]), 'rate-limit drift between doc and api/_ratelimit.js');
});

test('documented schema_version matches api/_schema.js', () => {
  const schema = readFileSync(path.join(root, 'api', '_schema.js'), 'utf8');
  const v = schema.match(/SCHEMA_VERSION\s*=\s*'([^']+)'/);
  assert.ok(v, 'SCHEMA_VERSION not found in api/_schema.js');
  assert.ok(
    new RegExp('`"?' + v[1] + '"?`').test(doc),
    `schema_version ${v[1]} not stated in doc`
  );
});

test('documented compute models match the dispatcher', () => {
  const h = readFileSync(path.join(root, 'api', '_handlers', 'compute.js'), 'utf8');
  const modelRows = [...doc.matchAll(/^\| `([a-zA-Z]+)` \|/gm)].map((m) => m[1]);
  assert.ok(modelRows.length >= 7, 'expected the full model table in the doc');
  for (const model of modelRows) {
    assert.ok(h.includes(`'${model}'`), `model ${model} documented but absent from api/_handlers/compute.js`);
  }
});

test('documented MCP tool names exist in mcp/server.js', () => {
  const server = readFileSync(path.join(root, 'mcp', 'server.js'), 'utf8');
  const tools = [...doc.matchAll(/^\s*- `([a-z_]+)` →/gm)].map((m) => m[1]);
  assert.ok(tools.length >= 4, 'expected the MCP tool list in the doc');
  for (const t of tools) {
    assert.ok(server.includes(`'${t}'`), `MCP tool ${t} documented but absent from mcp/server.js`);
  }
});

test('every repo file cited in the doc exists on disk', () => {
  const cites = [...doc.matchAll(/\b((?:api|mcp|scripts|public|test|lib)\/[A-Za-z0-9_\-./[\]]+\.(?:js|mjs|json|txt))\b/g)]
    // Skip URL/route references (always written with a leading slash,
    // e.g. GET /api/agent/capabilities.json) — only bare repo-path
    // citations like (api/_errors.js) are checked against disk.
    .filter((m) => m.index === 0 || doc[m.index - 1] !== '/')
    .map((m) => m[1]);
  assert.ok(cites.length >= 20, `expected inline source citations, got ${cites.length}`);
  for (const rel of new Set(cites)) {
    assert.ok(existsSync(path.join(root, rel)), `cited file does not exist: ${rel}`);
  }
});
