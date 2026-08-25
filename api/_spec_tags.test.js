// Regression tests for the self-describe/discovery cluster:
//   #706 — OpenAPI spec now carries a top-level `tags` taxonomy (mirroring
//          /api/agent/capabilities.json), stamps every operation with exactly
//          one tag, and cross-links the discovery surfaces via externalDocs.
//   #712 — bare GET /api/compute derives `otherEndpoints` from the central
//          route table so it advertises EVERY live endpoint (incl. /api/spec
//          itself), not a hand-picked four.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { default: handler } = await import(path.join(here, '[...path].js'));
const { ROUTES } = await import(path.join(here, '_route_table.js'));
const { API_TAGS, PATH_TAGS } = await import(path.join(here, '_handlers', 'spec.js'));

function fetchJson(url) {
  const chunks = [];
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(headers, String(k).toLowerCase()); },
    end(body) { chunks.push(String(body)); }
  };
  handler({ method: 'GET', url, query: {} }, res);
  assert.equal(res.statusCode, 200, `${url} should return 200`);
  return JSON.parse(chunks.join(''));
}

function operations(spec) {
  const ops = [];
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
      if (item[method]) ops.push({ path: p, method, op: item[method] });
    }
  }
  return ops;
}

// ---------- #706: OpenAPI tag taxonomy ----------

test('#706: spec has a top-level tags array with unique named tags', () => {
  const spec = fetchJson('/api/spec');
  assert.ok(Array.isArray(spec.tags) && spec.tags.length > 0, 'top-level tags missing');
  const names = spec.tags.map(t => t.name);
  assert.deepEqual(new Set(names).size, names.length, 'tag names must be unique');
  for (const t of spec.tags) {
    assert.equal(typeof t.description, 'string', `tag ${t.name} needs a description`);
  }
});

test('#706: every operation carries exactly one declared tag', () => {
  const spec = fetchJson('/api/spec');
  const declared = new Set(spec.tags.map(t => t.name));
  const ops = operations(spec);
  assert.ok(ops.length >= 15, `expected >=15 operations, got ${ops.length}`);
  for (const { path: p, method, op } of ops) {
    assert.ok(Array.isArray(op.tags) && op.tags.length === 1,
      `${method.toUpperCase()} ${p} must carry exactly one tag`);
    assert.ok(declared.has(op.tags[0]),
      `${method.toUpperCase()} ${p} uses undeclared tag "${op.tags[0]}"`);
  }
});

test('#706: PATH_TAGS covers every spec path with no stale entries', () => {
  const spec = fetchJson('/api/spec');
  const specPaths = Object.keys(spec.paths);
  assert.deepEqual(Object.keys(PATH_TAGS).sort(), specPaths.sort(),
    'PATH_TAGS keys must exactly match the spec paths');
  const tagNames = new Set(API_TAGS.map(t => t.name));
  for (const tag of Object.values(PATH_TAGS)) {
    assert.ok(tagNames.has(tag), `PATH_TAGS value "${tag}" is not a declared tag`);
  }
});

test('#706: externalDocs points at /llms.txt and cross-links discovery surfaces', () => {
  const spec = fetchJson('/api/spec');
  assert.ok(spec.externalDocs, 'externalDocs missing');
  assert.match(spec.externalDocs.url, /\/llms\.txt$/);
  const d = spec.externalDocs.description;
  for (const surface of ['/agents.json', '/.well-known/mcp.json', '/api/agent/capabilities.json']) {
    assert.ok(d.includes(surface), `externalDocs should mention ${surface}`);
  }
});

// ---------- #712: otherEndpoints generated from the route table ----------

test('#712: bare /api/compute advertises every non-compute route + /llms.txt', () => {
  const idx = fetchJson('/api/compute');
  const listed = idx.otherEndpoints;
  assert.ok(Array.isArray(listed));
  const expected = [
    ...ROUTES.filter(r => r.path !== '/compute').map(r => `/api${r.path}`),
    '/llms.txt'
  ];
  assert.deepEqual([...listed].sort(), [...expected].sort(),
    'otherEndpoints must equal the route-table routes minus /compute, plus /llms.txt');
  // The bootstrap-critical surfaces from the issue must be present…
  for (const must of ['/api/spec', '/api/benchmarks', '/api/best', '/api/sizing',
    '/api/diff', '/api/runs', '/api/watch', '/api/parse-constraints',
    '/api/snapshots', '/api/export', '/api/health', '/api/version',
    '/api/mcp', '/api/calc/:id', '/api/og']) {
    assert.ok(listed.includes(must), `otherEndpoints missing ${must}`);
  }
  // …and the old hand-picked subset must not have regressed.
  assert.ok(listed.length > 15, `expected >15 endpoints, got ${listed.length}`);
  assert.ok(!listed.includes('/api/compute'), 'must not list itself');
});
