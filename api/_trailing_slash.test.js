// Trailing-slash contract on /api/* (issues #943, #953): a slashed URL such
// as /api/spec/ — the exact entry point llms.txt/robots.txt/agents.json
// advertise — must resolve identically to /api/spec instead of falling into
// the catch-all 404. vercel.json's "trailingSlash": false is the platform
// layer (method-preserving 308 redirect); the dispatcher strips trailing
// slashes as the safety net for requests that still arrive slashed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import handler from '../api/[...path].js';

const here = dirname(fileURLToPath(import.meta.url));

async function callHandler(url, headers = {}) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    removeHeader(k) { delete this.headers[String(k).toLowerCase()]; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = body;
    }
  };
  await handler({ url, query: {}, headers }, res);
  return { status: captured.status, headers: res.headers, body: captured.body };
}

test('/api/spec/ resolves like /api/spec instead of 404ing', async () => {
  const plain = await callHandler('/api/spec');
  const slashed = await callHandler('/api/spec/');
  assert.equal(slashed.status, 200);
  assert.equal(slashed.status, plain.status);
  const parsed = JSON.parse(slashed.body);
  assert.ok(parsed.openapi || parsed.info, 'expected the OpenAPI document');
});

test('slashed variant of a data endpoint returns the same payload', async () => {
  const plain = JSON.parse((await callHandler('/api/health')).body);
  const slashed = JSON.parse((await callHandler('/api/health/')).body);
  assert.equal(slashed.ok, true);
  assert.deepEqual(Object.keys(slashed).sort(), Object.keys(plain).sort());
});

test('multiple trailing slashes are tolerated', async () => {
  const { status } = await callHandler('/api/health///');
  assert.equal(status, 200);
});

test('slashed discovery aliases resolve', async () => {
  for (const url of ['/api/version/', '/api/presets/', '/api/benchmarks/']) {
    const { status } = await callHandler(url);
    assert.equal(status, 200, `${url} should be 200`);
  }
});

test('unknown paths still 404 (slash stripping must not widen matching)', async () => {
  const { status } = await callHandler('/api/nope-does-not-exist/');
  assert.equal(status, 404);
});

test('vercel.json declares trailingSlash:false so slashed URLs 308-redirect', () => {
  const cfg = JSON.parse(readFileSync(join(here, '..', 'vercel.json'), 'utf8'));
  assert.equal(cfg.trailingSlash, false,
    'platform-level canonicalization: slashed URLs must 308 to the unslashed form');
});