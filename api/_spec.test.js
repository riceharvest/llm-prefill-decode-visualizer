import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './_handlers/spec.js';
import { SCHEMA_VERSION } from './_schema.js';

// The API publishes TWO independent version numbers (see CHANGELOG-API.md,
// section "Two version numbers"): info.version is the release version of the
// API surface, SCHEMA_VERSION is the wire contract carried by every response.
// These tests pin the mapping so the two can never silently drift apart.

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
    headers: { 'x-forwarded-for': `spec-test-${Math.random()}` },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const res = fakeRes();
  handler(req, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(res.bodyText);
}

test('spec exposes both version numbers with a stable mapping', () => {
  const spec = callSpec();

  // Release version: semver, tracks the API surface.
  assert.match(spec.info.version, /^\d+\.\d+\.\d+$/, 'info.version must be semver');
  assert.equal(spec.info.version, '2.6.0');

  // Wire contract version: mirrors SCHEMA_VERSION, independent of the release.
  assert.equal(spec.info['x-schema-version'], SCHEMA_VERSION);
  assert.equal(spec.info['x-schema-version'], '1');

  // The wire stamp on the spec response itself must agree with the mirror.
  assert.equal(spec.schema_version, spec.info['x-schema-version']);
});

test('x-schema-version stays in lockstep with SCHEMA_VERSION', () => {
  const spec = callSpec();
  // If this fails, either _schema.js bumped without updating the doc mapping
  // in CHANGELOG-API.md ("Two version numbers"), or someone hardcoded the
  // value in _handlers/spec.js instead of importing it.
  assert.equal(spec.info['x-schema-version'], SCHEMA_VERSION);
});

// #1057: every documented request body must carry a machine-readable schema.
// POST /api/watch was the only requestBody in the document and shipped an
// example with no schema, so spec-driven clients could not type-check it.
test('#1057 createWatch requestBody declares a schema matching validateWatch', () => {
  const spec = callSpec();
  const post = spec.paths['/api/watch'].post;
  const content = post.requestBody.content['application/json'];
  assert.ok(content.schema, 'watch requestBody must declare a schema');
  assert.equal(content.schema.type, 'object');
  for (const field of ['model', 'hardware', 'quant', 'webhookUrl']) {
    assert.equal(content.schema.properties[field].type, 'string', `${field} must be typed`);
  }
  // At least one of model/hardware is required (validateWatch combo rule).
  assert.deepEqual(content.schema.anyOf, [{ required: ['model'] }, { required: ['hardware'] }]);
  // The pre-existing example is preserved alongside the new schema.
  assert.equal(content.example.webhookUrl, 'https://example.com/hooks/llm-watch');
});
