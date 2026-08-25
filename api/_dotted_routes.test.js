// Regression tests for the dotted-API-route 404 (#548 #380 #468).
//
// Vercel treats URLs with a file extension (.json/.xml) as static assets:
// when no static file matches, the request 404s before reaching the
// api/[...path].js catch-all — so /api/agent/capabilities.json (and every
// other dotted /api route) was unreachable in production while
// extensionless routes worked fine.
//
// The fix has two halves, both guarded here:
//   1. vercel.json rewrites each dotted /api route to its extensionless form
//      (applied after the static filesystem check, so real static files like
//      public/api/agent/index.json keep winning).
//   2. canonicalApiPath() in the dispatcher restores the dotted path so the
//      existing switch serves both spellings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES } from './_route_table.js';
import handler, { canonicalApiPath } from './[...path].js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const dottedRoutes = ROUTES.map((r) => r.path).filter((p) => /\.(json|xml)$/.test(p));
assert.ok(dottedRoutes.length > 0, 'expected at least one dotted API route');

test('every dotted route round-trips through canonicalApiPath in both spellings', () => {
  for (const p of dottedRoutes) {
    const extless = p.replace(/\.(json|xml)$/, '');
    assert.equal(canonicalApiPath(p), p, `${p}: dotted form must stay canonical`);
    assert.equal(canonicalApiPath(extless), p, `${extless}: must normalize to ${p}`);
  }
});

test('unknown extensionless paths are left untouched by canonicalApiPath', () => {
  for (const p of ['/compute', '/does-not-exist', '/agent/nope']) {
    assert.equal(canonicalApiPath(p), p);
  }
});

test('vercel.json rewrites every dotted /api route to its single-segment alias', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const bySource = new Map(vercel.rewrites.map((r) => [r.source, r.destination]));
  for (const p of dottedRoutes) {
    const source = `/api${p}`;
    // Dotted URLs are routed to the static layer first and 404 on the miss
    // (#548); each one must carry a rewrite. Destinations use the established
    // single-segment aliases (agent-json?file=… / watch-rss) — multi-segment
    // /api/* destinations never reach the catch-all in production, so the
    // extensionless spelling asserted here originally is not routable either.
    const dest = bySource.get(source);
    const destPath = String(dest || '').split('?')[0];
    assert.ok(dest, `missing rewrite for ${source} in vercel.json`);
    assert.equal(
      destPath.replace(/^\/api\//, '').split('/').filter(Boolean).length,
      1,
      `${source} -> ${dest} must be single-segment`
    );
  }
});

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(this.headers, k); },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

/**
 * Drive the catch-all dispatcher with a rewritten (extensionless) URL and
 * assert it does NOT fall into the generic 404 case — i.e. the canonicalized
 * path matched a real route. Handlers are not executed to completion here;
 * any route hit produces a JSON body distinct from `{ error: 'Not found' }`.
 */
async function dispatchDoesNot404(url) {
  const res = mockRes();
  await handler({ method: 'GET', url, query: {} }, res);
  if (res.body === undefined) return true; // streamed response (e.g. RSS) — route hit
  let body;
  try {
    body = JSON.parse(res.body);
  } catch {
    return true; // non-JSON body implies a non-404 content handler ran
  }
  assert.notEqual(body.error, 'Not found', `${url} fell into the dispatcher's 404 case`);
  return true;
}

test('dispatcher serves rewritten extensionless forms of every dotted route', async () => {
  for (const p of dottedRoutes) {
    const extless = p.replace(/\.(json|xml)$/, '');
    // Handlers with side effects or upstream fetches are exercised only up
    // to routing; guard the ones that would do real work on GET.
    if (p.startsWith('/watch')) continue; // POST/DELETE-only flows; GET lists external state
    await dispatchDoesNot404(`/api${extless}`);
  }
});
