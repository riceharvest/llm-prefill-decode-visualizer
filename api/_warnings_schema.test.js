import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './_handlers/spec.js';
import { majorReleaseWarnings } from './_freshness.js';

// Issue #958: the warnings[] element schema contradicted the wire in two
// places — (1) ComputeResult.warnings.items declared object-only elements but
// model=flagged ships plain strings on the same field, and (2)
// majorReleaseWarnings declared string items on both BenchmarkGroup and
// BestResult while _freshness.js emits {engine, releaseVersion, ...} objects.
// These tests pin the corrected schemas to the shapes actually on the wire.

function fakeRes() {
  const headers = new Map();
  let body = '';
  return {
    statusCode: 0,
    setHeader(k, v) { headers.set(String(k).toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    end(chunk) { body += chunk ?? ''; },
    get bodyText() { return body; }
  };
}

function callSpec() {
  const req = {
    method: 'GET',
    url: '/api/spec',
    headers: { 'x-forwarded-for': `warn-schema-test-${Math.random()}` },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const res = fakeRes();
  handler(req, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(res.bodyText);
}

test('MajorReleaseWarning schema is registered and matches the wire shape', () => {
  const spec = callSpec();
  const schema = spec.components?.schemas?.MajorReleaseWarning;
  assert.ok(schema, 'components.schemas.MajorReleaseWarning must exist');
  assert.equal(schema.type, 'object');
  for (const key of ['engine', 'releaseVersion', 'releaseDate', 'newestRunAt', 'message']) {
    assert.ok(schema.required.includes(key), `${key} must be required`);
  }
  // releaseNote is emitted as null when unknown (_freshness.js: release.note || null)
  assert.ok(
    (schema.properties.releaseNote.type || []).includes('null'),
    'releaseNote must allow null'
  );

  // Wire check: every field the producer emits is declared by the schema.
  const warnings = majorReleaseWarnings(
    [{ engine: 'vLLM', createdAt: '2024-01-01T00:00:00.000Z' }],
    new Date('2026-08-24T00:00:00Z'),
    [{ engine: 'vLLM', version: 'V1', date: '2025-01-27', note: 'V1 scheduler rewrite' }]
  );
  assert.equal(warnings.length, 1, 'sample input should produce one warning');
  const wire = warnings[0];
  for (const key of Object.keys(wire)) {
    assert.ok(schema.properties[key], `wire field "${key}" must be declared in MajorReleaseWarning`);
  }
});

test('majorReleaseWarnings items reference MajorReleaseWarning, not string', () => {
  const spec = callSpec();
  const ref = '#/components/schemas/MajorReleaseWarning';
  // BestResult carries a top-level copy…
  const bestProp = spec.components.schemas.BestResult.properties.majorReleaseWarnings;
  assert.ok(bestProp, 'BestResult.majorReleaseWarnings must be declared');
  assert.equal(bestProp.items?.$ref, ref, 'BestResult.majorReleaseWarnings.items must $ref MajorReleaseWarning');
  // …and BenchmarkGroup carries it inside its freshness block.
  const freshProp = spec.components.schemas.BenchmarkGroup.properties.freshness?.properties?.majorReleaseWarnings;
  assert.ok(freshProp, 'BenchmarkGroup.freshness.majorReleaseWarnings must be declared');
  assert.equal(freshProp.items?.$ref, ref, 'freshness.majorReleaseWarnings.items must also $ref');
});

test('ComputeResult.warnings.items accepts both wire element types', () => {
  const spec = callSpec();
  const items = spec.components.schemas.ComputeResult.properties.warnings.items;
  assert.ok(Array.isArray(items.oneOf), 'warnings.items must be a oneOf (object + string)');

  const objBranch = items.oneOf.find(b => b.type === 'object');
  const strBranch = items.oneOf.find(b => b.type === 'string');
  assert.ok(objBranch, 'object branch ({code,message}) must exist');
  assert.ok(strBranch, 'string branch (model=flagged flag warnings) must exist');

  const codes = objBranch.properties.code.enum;
  for (const code of ['decode_above_bandwidth_roofline', 'prefill_above_compute_roofline', 'ttft_below_kernel_launch_floor']) {
    assert.ok(codes.includes(code), `code enum must keep ${code}`);
  }
});
