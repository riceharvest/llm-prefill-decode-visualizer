// Regression tests for #540: any /api/* URL with 2+ path segments escapes the
// catch-all function on Vercel (the platform router only hands over
// single-segment paths) and falls through to the plain-text platform NOT_FOUND
// instead of this dispatcher's JSON 404 contract.
//
// Fix shape (this repo can't change the platform router):
//   1. vercel.json rewrites funnel every KNOWN multi-segment route onto a
//      single-segment carrier that provably reaches api/[...path].js;
//   2. a final generic rewrite maps any other 2+-segment /api path to a
//      single-segment carrier too, so even a typo gets JSON, never text/plain.
// The dispatcher serves the carriers from its default branch (not `case`
// labels) so the route-table drift test keeps them out of agents.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES } from './_route_table.js';
import handler from './[...path].js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function vercelJson() {
  return JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(this.headers, k); },
    end(payload) { if (payload !== undefined) this.body += payload; }
  };
}

// Case-insensitive header lookup for mock res objects.
function header(res, name) {
  const key = Object.keys(res.headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? res.headers[key] : undefined;
}

async function call(url, query = {}) {
  const res = mockRes();
  await handler({ method: 'GET', url, headers: {}, query }, res);
  return res;
}

const multiSegmentRoutes = ROUTES.map((r) => r.path).filter((p) => p.slice(1).includes('/'));

test('#540: every known multi-segment /api route has a vercel.json rewrite', () => {
  assert.ok(multiSegmentRoutes.length > 0, 'expected multi-segment routes in the table');
  const bySource = new Map(vercelJson().rewrites.map((r) => [r.source, r.destination]));
  for (const p of multiSegmentRoutes) {
    const dest = bySource.get(`/api${p}`);
    assert.ok(dest, `missing rewrite for /api${p}`);
    // Carriers MUST be single-segment — that is the only shape the platform
    // router hands to the catch-all function (verified live, #540).
    const destPath = dest.split('?')[0];
    const seg = destPath.replace(/^\/api\//, '');
    assert.ok(seg && !seg.includes('/'), `/api${p} -> ${dest}: carrier must be single-segment`);
  }
});

test('#540: every rewrite carrier is actually served by the dispatcher', () => {
  const source = fs.readFileSync(path.join(root, 'api', '[...path].js'), 'utf8');
  const rewrites = vercelJson().rewrites.filter((r) => r.source.startsWith('/api/'));
  for (const r of rewrites) {
    const carrier = r.destination.split('?')[0].replace(/^\/api/, '');
    if (carrier === '/notfound') continue; // intentional fall-through to the JSON 404 branch
    assert.ok(
      source.includes(`'${carrier}'`),
      `carrier ${carrier} (from ${r.source}) is not handled in api/[...path].js`
    );
  }
});

test('#540: a generic rewrite funnels unknown multi-segment paths to a JSON 404 carrier', () => {
  const generic = vercelJson().rewrites.find((r) => r.source === '/api/:a/:b*');
  assert.ok(generic, 'expected the generic /api/:a/:b* funnel rewrite');
  assert.equal(generic.destination.split('?')[0], '/api/notfound');
});

test('#540: unknown multi-segment request reaches the dispatcher JSON 404 (carrier path)', async () => {
  // Simulates what the generic rewrite hands the function:
  // /api/compute/extra/path -> GET /api/notfound?a=compute&b=extra/path
  const res = await call('/api/notfound?a=compute&b=extra/path', { a: 'compute', b: 'extra/path' });
  assert.equal(res.statusCode, 404);
  assert.match(header(res, 'content-type'), /application\/json/);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'Not found');
  assert.equal(body.path, '/compute/extra/path');
});

test('#540: unknown single-segment requests keep their existing JSON 404 echo', async () => {
  const res = await call('/api/totally-bogus');
  assert.equal(res.statusCode, 404);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'Not found');
  assert.equal(body.path, '/totally-bogus');
});
