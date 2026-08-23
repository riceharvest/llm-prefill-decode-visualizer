// Regression tests for the OpenAPI document served by /api/spec (#319).
//
// The spec now carries real reusable component schemas (Run, BenchmarkGroup,
// BestResult, ComputeResult plus shared/envelope shapes) that are referenced
// via $ref from the path responses. These tests pin that contract:
//   1. every $ref in the document resolves to a components.schemas entry,
//   2. the named resource + envelope schemas exist,
//   3. the four data endpoints actually reference them (not just define them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Route through the catch-all handler, same as scripts/dump-openapi.mjs
// (api/spec.js was consolidated into api/[...path].js).
const here = path.dirname(fileURLToPath(import.meta.url));
const { default: handler } = await import(path.join(here, '..', '[...path].js'));

function fetchSpec() {
  const chunks = [];
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    end(body) { chunks.push(String(body)); }
  };
  handler({ method: 'GET', url: '/api/spec', query: {} }, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(chunks.join(''));
}

/** Collect every internal $ref in a JSON-serializable value. */
function collectRefs(node, refs = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/')) refs.push(v);
      else collectRefs(v, refs);
    }
  }
  return refs;
}

function resolveRef(spec, ref) {
  let cur = spec;
  for (const part of ref.slice(2).split('/')) {
    cur = cur?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (cur == null) return undefined;
  }
  return cur;
}

test('spec: every internal $ref resolves to a component schema', () => {
  const spec = fetchSpec();
  const refs = collectRefs(spec);
  assert.ok(refs.length > 0, 'spec should contain internal $refs');
  const unresolved = refs.filter(ref => resolveRef(spec, ref) === undefined);
  assert.deepEqual(unresolved, [], `unresolved $refs: ${unresolved.join(', ')}`);
});

test('spec: components.schemas defines the core resource + envelope schemas', () => {
  const { components: { schemas } } = fetchSpec();
  for (const name of [
    // Core resources
    'Run', 'BenchmarkGroup', 'BestResult', 'ComputeResult',
    // Shared building blocks
    'Caveat', 'Confidence', 'SpeedStats', 'SnapshotRef', 'Problem',
    // Envelope shapes
    'RunListEnvelope', 'BenchmarkGroupListEnvelope', 'BestListEnvelope'
  ]) {
    assert.ok(schemas[name], `components.schemas.${name} missing`);
    assert.equal(schemas[name].type, 'object', `${name} should be an object schema`);
  }
});

test('spec: data endpoints reference the reusable schemas via $ref', () => {
  const spec = fetchSpec();
  const schemaOf = (p) =>
    spec.paths[p]?.get?.responses?.['200']?.content?.['application/json']?.schema;

  assert.equal(
    JSON.stringify(schemaOf('/api/compute')?.$ref ?? []),
    JSON.stringify('#/components/schemas/ComputeResponse'),
    '/api/compute 200 should $ref ComputeResponse'
  );

  const localmaxxingRefs = collectRefs(schemaOf('/api/localmaxxing'));
  assert.ok(
    localmaxxingRefs.includes('#/components/schemas/RunListEnvelope'),
    '/api/localmaxxing 200 should $ref RunListEnvelope'
  );
  assert.ok(
    localmaxxingRefs.includes('#/components/schemas/HardwareSummaryEnvelope'),
    '/api/localmaxxing 200 should $ref HardwareSummaryEnvelope'
  );

  assert.equal(
    schemaOf('/api/benchmarks')?.$ref,
    '#/components/schemas/BenchmarkGroupListEnvelope',
    '/api/benchmarks 200 should $ref BenchmarkGroupListEnvelope'
  );
  assert.equal(
    schemaOf('/api/best')?.$ref,
    '#/components/schemas/BestListEnvelope',
    '/api/best 200 should $ref BestListEnvelope'
  );
});
