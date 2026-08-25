// /api/calc/<id> replay reachability (#474): the file-routed alias module
// (api/calc.js) must delegate to the shared replay handler, and the
// vercel.json rewrite that makes /api/calc/<id> resolvable on the deployed
// platform is pinned so it cannot silently disappear.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import calcAlias from './calc.js';

const here = dirname(fileURLToPath(import.meta.url));

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

test('api/calc.js delegates to the shared calc_id replay handler', async () => {
  const res = mockRes();
  // No id → the handler's own 400 usage contract, proving delegation happened.
  await calcAlias({ method: 'GET', query: {} }, res);
  assert.equal(res.statusCode, 400);
  let json; try { json = JSON.parse(res.body); } catch {}
  assert.match(json?.error ?? '', /[Ii]nvalid calc id/);
});

test('alias accepts an id + params exactly like the catch-all path does', async () => {
  const res = mockRes();
  await calcAlias({ method: 'GET', query: { id: 'not-a-calc-id' } }, res);
  assert.equal(res.statusCode, 400);
  let json; try { json = JSON.parse(res.body); } catch {}
  assert.match(json.error, /not-a-calc-id/);
});

test('vercel.json rewrites /api/calc/:id onto the file-routed function (#474)', () => {
  const cfg = JSON.parse(readFileSync(join(here, '..', 'vercel.json'), 'utf8'));
  const rewrite = (cfg.rewrites || []).find(r => r.source === '/api/calc/:id');
  assert.ok(rewrite, 'missing /api/calc/:id rewrite');
  assert.equal(rewrite.destination, '/api/calc?id=:id');
});
