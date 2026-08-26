// #709 — the OpenAPI spec's "versioned" server (https://…/v1 + /api/* paths)
// resolves every path to /v1/api/<endpoint>. That shape must rewrite back onto
// /api/<endpoint> instead of 404ing. Pins the vercel.json contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

test('vercel.json rewrites /v1/api/* onto /api/* (spec servers[1] resolves, #709)', () => {
  const rules = vercel.rewrites;
  const specific = rules.find(r => r.source === '/v1/api/:path*');
  assert.ok(specific, 'missing /v1/api/:path* rewrite');
  assert.equal(specific.destination, '/api/:path*');
});

test('/v1/api rule precedes the generic /v1 rule (first match wins)', () => {
  const rules = vercel.rewrites;
  const sources = rules.map(r => r.source);
  const specificIdx = sources.indexOf('/v1/api/:path*');
  const genericIdx = sources.indexOf('/v1/:path*');
  assert.ok(genericIdx !== -1, 'generic /v1/:path* alias missing');
  assert.ok(specificIdx < genericIdx,
    '/v1/api/:path* must be evaluated before /v1/:path*, otherwise /v1/api/x collapses to /api/api/x');
});

test('the generic /v1/ alias is untouched', () => {
  const generic = vercel.rewrites.find(r => r.source === '/v1/:path*');
  assert.equal(generic.destination, '/api/:path*');
});
