import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './capabilities.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

function call(method = 'GET') {
  const res = mockRes();
  handler({ method, url: '/api/agent/capabilities.json' }, res);
  assert.ok(res.body, 'handler must end the response with a body');
  return { res, body: JSON.parse(res.body) };
}

test('responds 200 with application/json content type', () => {
  const { res } = call();
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /^application\/json/);
});

test('lists the core agent-facing API surfaces', () => {
  const { body } = call();
  const paths = new Set(body.surfaces.map(s => s.path));
  for (const key of [
    '/api/compute',
    '/api/spec',
    '/api/benchmarks',
    '/api/localmaxxing',
    '/api/best',
    '/api/snapshots',
    '/api/watch/rss.xml'
  ]) {
    assert.ok(paths.has(key), `missing key surface ${key}`);
  }
});

test('lists non-JSON agent surfaces: MCP, manifest and guide', () => {
  const { body } = call();
  const paths = new Set(body.surfaces.map(s => s.path));
  for (const key of ['/api/mcp', '/.well-known/mcp.json', '/llms.txt', '/agents.json']) {
    assert.ok(paths.has(key), `missing agent surface ${key}`);
  }
});

test('every surface entry has a path, methods and a description', () => {
  const { body } = call();
  assert.ok(body.surfaces.length >= 15, 'expected a substantial surface list');
  for (const s of body.surfaces) {
    assert.equal(typeof s.path, 'string');
    assert.ok(s.path.startsWith('/') && !s.path.endsWith('/'), s.path);
    assert.ok(Array.isArray(s.methods) && s.methods.length > 0, `${s.path} methods`);
    for (const m of s.methods) assert.match(m, /^[A-Z]+$/, `${s.path} method ${m}`);
    assert.equal(typeof s.description, 'string');
    assert.ok(s.description.length > 10, `${s.path} description too thin`);
    assert.match(s.kind, /^[a-z0-9-]+$/i, `${s.path} kind`);
  }
});

test('self-describing metadata: service identity, docs, versioning, CORS/auth', () => {
  const { body } = call();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'llm-prefill-decode-visualizer');
  assert.match(String(body.base_url), /^https:\/\//);
  assert.equal(body.auth, 'none');
  assert.equal(body.cors, true);
  assert.equal(body.docs.openapi, '/api/spec');
  assert.equal(body.docs.guide, '/llms.txt');
  assert.match(body.versioning.versionedPrefix, /^\/v\d+\/$/);
  assert.equal(typeof body.rateLimit.limitPerMinutePerInstance, 'number');
});

test('carries the standard schema_version stamp and header', () => {
  const { res, body } = call();
  assert.equal(body.schema_version, '1');
  assert.equal(res.headers['X-Schema-Version'], '1');
});

test('surfaceCount matches the actual surfaces array length', () => {
  const { body } = call();
  assert.equal(body.surfaceCount, body.surfaces.length);
});

test('rejects non-GET requests with 405 and an Allow header', () => {
  const { res, body } = call('POST');
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
  assert.equal(body.error, 'method_not_allowed');
});
