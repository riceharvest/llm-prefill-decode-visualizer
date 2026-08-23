// Contract tests for the static JSON Schema files served from /schemas/*.
//
// These schemas are documentation artifacts: they describe the wire shape of
// the key API endpoints so agents can validate payloads without calling the
// API. Because they are static, they can silently drift away from what the
// handlers actually read/emits — these tests pin them:
//   1. each .schema.json parses as JSON,
//   2. it carries the required draft-07 meta-keys ($schema, type, properties,
//      required where applicable),
//   3. every internal $ref resolves inside the same document,
//   4. every property name declared anywhere in the schema appears verbatim
//      in the handler/module sources that produce or consume that field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(HERE, '../public/schemas');

// Endpoint -> { schema file, sources whose code reads/emits its fields }.
const ENDPOINTS = [
  {
    name: '/api/compute',
    schema: 'compute.schema.json',
    sources: [
      'api/_handlers/compute.js',
      'api/_math.js',
    ],
  },
  {
    // NOTE: there is no literal /api/runs route on this branch — the raw
    // community benchmark runs endpoint is /api/localmaxxing (GET list /
    // POST submit). runs.schema.json documents that handler.
    name: '/api/localmaxxing (runs)',
    schema: 'runs.schema.json',
    sources: [
      'api/_handlers/localmaxxing.js',
      'api/_submit.js',
      'api/_localmaxxing.js',
      'api/_freshness.js',
    ],
  },
];

/** Recursively collect property names + required entries from a schema node. */
function collectFieldNames(node, out = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectFieldNames(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (node.properties && typeof node.properties === 'object') {
    for (const [name, subschema] of Object.entries(node.properties)) {
      out.add(name);
      collectFieldNames(subschema, out);
    }
  }
  if (Array.isArray(node.required)) {
    for (const name of node.required) out.add(name);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' || key === 'required' || key.startsWith('$')) continue;
    collectFieldNames(value, out);
  }
  return out;
}

/** Resolve every local $ref pointer in the document, throwing on a miss. */
function assertLocalRefsResolve(root, node, path = '#') {
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertLocalRefsResolve(root, item, `${path}/${i}`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    let cursor = root;
    for (const segment of node.$ref.slice(2).split('/')) {
      const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      assert.ok(
        cursor && Object.prototype.hasOwnProperty.call(cursor, decoded),
        `${path}: unresolvable $ref ${node.$ref} (missing '${decoded}')`
      );
      cursor = cursor[decoded];
    }
  }
  for (const [key, value] of Object.entries(node)) {
    assertLocalRefsResolve(root, value, `${path}/${key}`);
  }
}

for (const endpoint of ENDPOINTS) {
  test(`${endpoint.schema}: parses as JSON with required draft-07 meta-keys`, () => {
    const filePath = resolve(SCHEMA_DIR, endpoint.schema);
    assert.ok(existsSync(filePath), `${endpoint.schema} must exist under public/schemas/`);

    const raw = readFileSync(filePath, 'utf8');
    const schema = JSON.parse(raw); // throws (fails the test) on invalid JSON

    assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
    assert.equal(schema.type, 'object');
    assert.ok(schema.properties && typeof schema.properties === 'object');
    assert.ok(Object.keys(schema.properties).length > 0, 'top level must declare properties');
    assert.ok(Array.isArray(schema.required), '"required" must be present (possibly empty)');
    assert.ok(
      schema.title && schema.description,
      'schemas must carry a title and description for consumers'
    );
    assert.ok(schema.definitions && typeof schema.definitions === 'object');
  });

  test(`${endpoint.schema}: all local $ref pointers resolve`, () => {
    const schema = JSON.parse(readFileSync(resolve(SCHEMA_DIR, endpoint.schema), 'utf8'));
    assertLocalRefsResolve(schema, schema);
  });

  test(`${endpoint.schema}: every declared field matches the actual handler code`, () => {
    // Handler modules must exist before we can cross-check against them.
    for (const rel of endpoint.sources) {
      const src = resolve(HERE, '..', rel);
      assert.ok(existsSync(src), `handler source must exist: ${rel}`);
    }

    const schema = JSON.parse(readFileSync(resolve(SCHEMA_DIR, endpoint.schema), 'utf8'));
    const combined = endpoint.sources
      .map(rel => readFileSync(resolve(HERE, '..', rel), 'utf8'))
      .join('\n');

    const fields = collectFieldNames(schema);
    assert.ok(fields.size > 20, `expected a substantial field set, got ${fields.size}`);

    const missing = [...fields].filter(name => !combined.includes(name));
    assert.deepEqual(
      missing,
      [],
      `fields declared in ${endpoint.schema} but absent from handler sources: ${missing.join(', ')}`
    );
  });
}
