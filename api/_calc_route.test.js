// Tests for the /api/calc/<id> replay route (#592).
//
// The documented deterministic-replay endpoint 404s at the platform edge in
// production: multi-segment /api/* paths never reach the api/[...path].js
// catch-all (see #540 for the general mechanism). The fix is a filesystem-
// routed dynamic function at api/calc/[id].js that delegates to the exact
// same handler the dispatcher uses. These tests pin that contract:
//   - the file-routed entry re-exports the shared calc_id handler + config,
//   - the route still replays a real computation end-to-end (verified:true),
//   - the vercel.json /v1/ rewrite still lands /v1/calc/<id> on this path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fileHandler = (await import('./_handlers/calc_id.js')).default;
const fileConfig = (await import('./_handlers/calc_id.js')).config;

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    end(b) { this.body = b ? JSON.parse(b) : null; }
  };
}

test('api/calc/[id].js delegates to the shared calc_id handler', async () => {
  const routed = await import('./calc/[id].js');
  assert.equal(routed.default, fileHandler, 'one implementation — zero drift');
  assert.deepEqual(routed.config, fileConfig);
});

test('#592: replay round-trip through the file-routed entry verifies the id', async () => {
  const { computeBody } = await import('./_handlers/compute.js');
  const params = { model: 'singleTurn', promptTokens: 4096, outputTokens: 512 };
  const minted = computeBody(params).body;
  assert.ok(minted.id, 'sanity: compute mints an id');

  const res = mockRes();
  await fileHandler({ method: 'GET', query: { ...params, id: minted.id } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, minted.id);
  assert.equal(res.body.verified, true, 'replayed result is stamped verified');
});

test('#592: invalid ids get the JSON 400 contract, not a platform text 404', async () => {
  const res = mockRes();
  await fileHandler({ method: 'GET', query: { model: 'singleTurn', id: 'not-a-calc-id' } }, res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.includes('Invalid calc id'));
});

test('vercel.json keeps routing /v1/calc/:id onto /api/calc/:id', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const v1 = cfg.rewrites.find(r => r.source === '/v1/:path*');
  assert.ok(v1, '/v1/:path* rewrite must exist');
  assert.equal(v1.destination, '/api/:path*');
});
