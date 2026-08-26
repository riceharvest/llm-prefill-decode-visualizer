// #469 — /agents.json $schema must be fetchable. The former target
// (spec.agentproviders.dev) has no DNS record, so the manifest now points at
// a schema served by the same origin, and that schema must actually describe
// the manifest's shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'public', 'agents.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(root, 'public', 'agents.v1.schema.json'), 'utf8'));

test('agents.json $schema points at the self-hosted schema (#469)', () => {
  const url = new URL(manifest.$schema);
  assert.equal(url.host, new URL(manifest.url).host);
  assert.match(url.pathname, /agents\.v1\.schema\.json$/);
  assert.ok(!manifest.$schema.includes('agentproviders.dev'), 'dead spec.agentproviders.dev pointer must not come back');
});

test('the shipped schema file is itself valid JSON Schema draft-07', () => {
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.type, 'object');
  assert.ok(Array.isArray(schema.required));
  assert.ok(schema.properties.endpoints, 'endpoints property must be described');
});

test('the schema describes every top-level key the manifest actually ships', () => {
  for (const key of Object.keys(manifest)) {
    assert.ok(
      Object.hasOwn(schema.properties, key) || schema.additionalProperties === true,
      `manifest key "${key}" must be declared or additionalProperties allowed`
    );
  }
  for (const req of schema.required) {
    assert.ok(req in manifest, `schema requires "${req}" but manifest lacks it`);
  }
});

test('every endpoint entry satisfies the schema-required members', () => {
  assert.ok(manifest.endpoints.length > 0);
  for (const ep of manifest.endpoints) {
    for (const req of schema.properties.endpoints.items.required) {
      assert.ok(ep[req] !== undefined && ep[req] !== null, `${ep.path}: missing "${req}"`);
    }
  }
});
