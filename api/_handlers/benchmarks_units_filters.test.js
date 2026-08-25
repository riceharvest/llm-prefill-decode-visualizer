// Regression tests for #773 + #776:
//
//  #773 — /api/spec must declare the five working /api/benchmarks query
//         filters (engine, crossEngine, include_outliers, outlierIqrs,
//         max_age) that the endpoint's own description advertises.
//  #776 — /api/benchmarks responses must carry machine-readable unit
//         metadata (`units.speed`) for the aggregate speed numbers instead
//         of leaving "tok/s" only inside prose strings.
//
// Run: node --test api/_handlers/benchmarks_units_filters.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import specHandler from './spec.js';
import benchmarksHandler from './benchmarks.js';

function mockRes() {
  const headers = new Map();
  let statusCode = 200;
  let endedBody = null;
  return {
    get headers() { return Object.fromEntries(headers); },
    get endedBody() { return endedBody; },
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    status(v) { statusCode = v; return this; },
    setHeader(k, v) { headers.set(k.toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    hasHeader(k) { return headers.has(String(k).toLowerCase()); },
    end(body) { endedBody = body ?? ''; }
  };
}

async function callHandler(handler, { query = {}, method = 'GET' } = {}) {
  const req = { method, query, url: '/api/test' };
  const res = mockRes();
  await handler(req, res);
  let parsed = null;
  try { parsed = JSON.parse(res.endedBody); } catch { /* non-JSON */ }
  return { status: res.statusCode, body: parsed };
}

test('#773: /api/spec declares engine/crossEngine/include_outliers/outlierIqrs/max_age on GET /api/benchmarks', async () => {
  const { body: spec } = await callHandler(specHandler);
  const params = spec.paths['/api/benchmarks'].get.parameters.map(p => p.name);
  for (const name of ['engine', 'crossEngine', 'include_outliers', 'outlierIqrs', 'max_age']) {
    assert.ok(params.includes(name), `missing query param ${name} in /api/spec`);
  }
});

test('#773: outlierIqrs param documents its 1..10 bounds and default', async () => {
  const { body: spec } = await callHandler(specHandler);
  const p = spec.paths['/api/benchmarks'].get.parameters.find(x => x.name === 'outlierIqrs');
  assert.equal(p.schema.minimum, 1);
  assert.equal(p.schema.maximum, 10);
  assert.equal(p.schema.default, 2.5);
});

test('#773: crossEngine + include_outliers are boolean-typed in the spec', async () => {
  const { body: spec } = await callHandler(specHandler);
  const params = spec.paths['/api/benchmarks'].get.parameters;
  for (const name of ['crossEngine', 'include_outliers']) {
    assert.equal(params.find(x => x.name === name).schema.type, 'boolean', `${name} should be boolean`);
  }
});

test('#776: wire response carries units.speed = "tok/s"', async () => {
  const { body } = await callHandler(benchmarksHandler, { query: { limit: '2' } });
  assert.deepEqual(body.units, { speed: 'tok/s' });
});

test('#776: BenchmarkGroupListEnvelope schema declares units', async () => {
  const { body: spec } = await callHandler(specHandler);
  const units = spec.components.schemas.BenchmarkGroupListEnvelope.properties.units;
  assert.ok(units, 'units missing from BenchmarkGroupListEnvelope');
  assert.equal(units.properties.speed.const, 'tok/s');
});

test('#776: spec example includes the units block and matches the wire shape', async () => {
  const example = (await callHandler(specHandler)).body
    .paths['/api/benchmarks'].get.responses['200'].content['application/json'].example;
  assert.deepEqual(example.units, { speed: 'tok/s' });
});
