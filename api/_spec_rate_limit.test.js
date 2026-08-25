// Contract tests for the x-rate-limit OpenAPI extension (see _handlers/spec.js).
//
// Guarantees for agent consumers of /api/spec:
//   1. every operation carries an x-rate-limit object,
//   2. its limit/window match the live limiter constants in _ratelimit.js
//      (no drift between docs and enforcement),
//   3. `enforced` matches whether the backing handler module really calls
//      enforceRateLimit() — checked against handler source, not a hardcoded
//      list alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import specHandler from './_handlers/spec.js';
import { RATE_LIMIT, RATE_WINDOW_MS, _resetRateLimits } from './_ratelimit.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Invoke the spec handler with mock req/res and return the parsed spec. */
function fetchSpec() {
  _resetRateLimits();
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
    hasHeader(k) { return Object.keys(headers).some(h => h.toLowerCase() === String(k).toLowerCase()); },
    end(body) { res.body = body; }
  };
  specHandler({ headers: {}, url: '/api/spec' }, res);
  assert.equal(res.statusCode, 200, 'spec handler should return 200');
  return JSON.parse(res.body);
}

/** All operations in the spec as [path, method, operation] triples. */
function operations(spec) {
  const ops = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
      if (item[method]) ops.push([path, method, item[method]]);
    }
  }
  return ops;
}

// Spec path -> handler module that actually serves it (see [...path].js).
const HANDLER_FILE = {
  '/api/compute': '_handlers/compute.js',
  '/api/vram': '_handlers/vram.js',
  '/api/calc/{id}': '_handlers/calc_id.js',
  '/api/presets': '_handlers/presets.js',
  '/api/localmaxxing': '_handlers/localmaxxing.js',
  '/api/runs': '_handlers/runs.js',
  '/api/watch': '_watch_impl.js',
  '/api/watch/rss.xml': '_handlers/rss.xml.js',
  '/api/watch/dispatch': '_handlers/dispatch.js',
  '/api/benchmarks': '_handlers/benchmarks.js',
  '/api/best': '_handlers/best.js',
  '/api/health': '_handlers/health.js',
  '/api/sizing': '_handlers/sizing.js',
  '/api/parse-constraints': '_handlers/parse-constraints.js',
  '/api/snapshots': '_handlers/snapshots.js'
};

test('every OpenAPI operation carries an x-rate-limit object', () => {
  const spec = fetchSpec();
  const ops = operations(spec);
  assert.ok(ops.length >= 15, `expected a real spec, got ${ops.length} operations`);
  for (const [path, method, op] of ops) {
    const ext = op['x-rate-limit'];
    assert.ok(ext, `${method.toUpperCase()} ${path} is missing x-rate-limit`);
    assert.equal(typeof ext.enforced, 'boolean', `${method.toUpperCase()} ${path}: enforced must be boolean`);
    assert.equal(ext.limit, RATE_LIMIT, `${method.toUpperCase()} ${path}: limit drift from _ratelimit.js`);
    assert.equal(ext.windowSeconds, RATE_WINDOW_MS / 1000, `${method.toUpperCase()} ${path}: window drift`);
    assert.equal(typeof ext.keying, 'string');
    assert.ok(ext.scope.includes('per serverless instance'), 'scope must state the per-instance caveat');
  }
});

test('root-level x-rate-limit default matches the live constants', () => {
  const spec = fetchSpec();
  assert.equal(spec['x-rate-limit'].limit, RATE_LIMIT);
  assert.equal(spec['x-rate-limit'].windowSeconds, RATE_WINDOW_MS / 1000);
  assert.equal(spec['x-rate-limit'].enforced, true);
});

test('enforced endpoints advertise headers + 429 exhaustion shape', () => {
  const spec = fetchSpec();
  for (const [path, method, op] of operations(spec)) {
    const ext = op['x-rate-limit'];
    if (!ext.enforced) continue;
    assert.deepEqual(ext.headers, ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']);
    assert.equal(ext.onExhaustion.status, 429);
    assert.match(ext.onExhaustion.retryAfterHeader, /Retry-After/);
    assert.equal(ext.onExhaustion.errorCode, 'RATE_LIMITED');
    assert.equal(ext.onExhaustion.response.$ref, '#/components/responses/RateLimited');
  }
});

test('non-enforced endpoints say so instead of implying metering', () => {
  const spec = fetchSpec();
  const unmetered = operations(spec).filter(([, , op]) => !op['x-rate-limit'].enforced);
  // /api/calc/{id} became metered in #957 (a replay re-runs the same math, so
  // it must not be an unmetered bypass), leaving vram/sizing/health/snapshots.
  assert.ok(unmetered.length >= 4, 'expected several unmetered endpoints (vram, sizing, health, …)');
  for (const [path, method, op] of unmetered) {
    assert.ok(op['x-rate-limit'].note.includes('not metered'), `${method.toUpperCase()} ${path} must state it is unmetered`);
    assert.equal(op['x-rate-limit'].headers, undefined);
    assert.equal(op['x-rate-limit'].onExhaustion, undefined);
  }
});

test('enforced flag agrees with the backing handler source', () => {
  const spec = fetchSpec();
  for (const [path, , op] of operations(spec)) {
    const file = HANDLER_FILE[path];
    assert.ok(file, `no handler mapping for spec path ${path} — update HANDLER_FILE`);
    const src = readFileSync(join(HERE, file), 'utf8');
    const actuallyEnforces = src.includes('enforceRateLimit');
    assert.equal(
      op['x-rate-limit'].enforced,
      actuallyEnforces,
      `${path}: spec says enforced=${op['x-rate-limit'].enforced} but ${file} ${actuallyEnforces ? 'calls' : 'does not call'} enforceRateLimit`
    );
  }
});
