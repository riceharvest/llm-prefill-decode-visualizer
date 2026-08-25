// Regression guards for #1083: two OpenAPI defects made openapi-python-client
// silently skip whole endpoints (exit 0, no module, CI green):
//   1. GET /api/compute `precisionBytes` carried a mixed-type enum [2,1,0.5]
//      under type:number -> computeInference never generated;
//   2. POST /api/watch declared a requestBody with only an example and NO
//      schema -> createWatch never generated.
// A third defect (ComputeResponse allOf+siblings) dropped both ComputeResult
// and ComputeResponse from the generated models. These tests pin the spec
// shapes that keep every generator path alive; the committed client under
// clients/python must contain all 17 operation modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const chunks = [];
const headers = {};
const res = {
  statusCode: 200,
  setHeader(k, v) { headers[k.toLowerCase()] = v; },
  getHeader(k) { return headers[String(k).toLowerCase()]; },
  end(body) { chunks.push(String(body)); },
};

const { default: specHandler } = await import('./_handlers/spec.js');
specHandler({ method: 'GET', url: '/api/spec' }, res);

const spec = JSON.parse(chunks.join(''));

test('precisionBytes query param carries no mixed-type enum (#1083)', () => {
  const params = spec.paths['/api/compute'].get.parameters;
  const p = params.find(p => p.name === 'precisionBytes');
  assert.ok(p, 'precisionBytes param exists on GET /api/compute');
  assert.equal(p.schema.type, 'number');
  // openapi-python-client aborts the endpoint on an enum mixing ints and
  // floats ("Got {<class 'float'>, <class 'int'>}") — values are documented
  // in the description instead of enum-constrained.
  assert.equal(p.schema.enum, undefined);
  for (const v of [2, 1, 0.5]) {
    assert.ok(String(p.schema.description).includes(String(v)), `description documents value ${v}`);
  }
});

test('POST /api/watch requestBody has a real schema (#1083)', () => {
  const body = spec.paths['/api/watch'].post.requestBody.content['application/json'];
  assert.ok(body.schema, 'requestBody declares a schema (example alone makes generators drop the endpoint)');
  assert.equal(body.schema.type, 'object');
  for (const prop of ['model', 'hardware', 'quant', 'webhookUrl']) {
    assert.ok(body.schema.properties[prop], `schema documents ${prop}`);
  }
});

test('ComputeResponse is a flat object schema, not allOf+siblings (#1083)', () => {
  const cr = spec.components.schemas.ComputeResponse;
  assert.ok(cr, 'ComputeResponse registered');
  assert.equal(cr.allOf, undefined, 'no allOf composition (openapi-python-client cannot process it)');
  assert.equal(cr.type, 'object');
  assert.ok(cr.properties.id, 'ComputeResult fields inlined');
  assert.ok(cr.properties.schema_version, 'envelope stamp kept');
  assert.deepEqual(cr.required, ['inputs', 'warnings', 'schema_version']);
});

test('committed Python client ships all 17 operation modules (#1083)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const ops = new Set();
  for (const item of Object.values(spec.paths)) {
    for (const op of Object.values(item)) {
      if (op && typeof op === 'object' && op.operationId) ops.add(op.operationId);
    }
  }
  const apiDir = join(here, '..', 'clients', 'python', 'llm_prefill_decode_speed_visualizer_api_client', 'api', 'default');
  const modules = new Set(readdirSync(apiDir).filter(f => f.endsWith('.py')).map(f => f.slice(0, -3)));
  // snake_case operationId -> module name convention of openapi-python-client.
  const toModule = (id) => id.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
  for (const op of ops) {
    assert.ok(modules.has(toModule(op)), `operation ${op} has a generated module (${toModule(op)}.py)`);
  }
  // The two endpoints that silently vanished before #1083:
  assert.ok(modules.has('create_watch'), 'create_watch.py present');
  assert.ok(modules.has('compute_inference'), 'compute_inference.py present');
});
