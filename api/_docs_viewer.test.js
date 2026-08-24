import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import handler from './_handlers/spec.js';

// #900 — hosted interactive API docs viewer. /docs serves a minimal Scalar
// reference UI pointed at /api/spec. These tests pin the wiring so the page,
// its route and a parseable spec document can't silently drift apart.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
    headers: { 'x-forwarded-for': `docs-test-${Math.random()}` },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const res = fakeRes();
  handler(req, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(res.bodyText);
}

test('/docs page exists and wires Scalar to the live spec', () => {
  const html = readFileSync(join(ROOT, 'public', 'docs.html'), 'utf8');

  // Scalar standalone build: spec URL comes from #api-reference[data-url].
  assert.match(html, /id="api-reference"/, 'viewer mount point missing');
  assert.match(html, /data-url="\/api\/spec"/, 'viewer must load the canonical /api/spec document');
  assert.match(html, /@scalar\/api-reference/, 'Scalar CDN script missing');

  // Discovery parity with index.html (#362).
  assert.match(html, /rel="llms\.txt"/, 'docs page should surface /llms.txt');
});

test('vercel.json routes /docs (and trailing slash) to the viewer', () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const rewrites = vercel.rewrites || [];
  const sources = new Map(rewrites.map(r => [r.source, r.destination]));

  assert.equal(sources.get('/docs'), '/docs.html', '/docs must serve docs.html');
  assert.equal(sources.get('/docs/'), '/docs.html', '/docs/ must serve docs.html');
});

test('spec document is structurally valid enough for viewers to parse (#900/#885)', () => {
  const spec = callSpec();

  assert.equal(spec.openapi, '3.1.0');
  // Viewers hard-fail on unresolved $ref targets.
  for (const [, responses] of Object.entries(spec.components?.responses || {})) {
    assert.ok(responses, 'component response must be non-empty');
  }

  // No HTTP-status key may sit at operation level next to `responses`
  // (the #885 defect: GET /api/compute carried a misplaced sibling '429').
  const violations = [];
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!op || typeof op !== 'object' || !op.responses) continue;
      assert.ok(op.responses['200'] || op.responses['201'] || op.responses['204'] || op.responses.default,
        `${method.toUpperCase()} ${path} has no success/default response`);
      for (const key of Object.keys(op)) {
        if (/^\d{3}$/.test(key)) violations.push(`${method.toUpperCase()} ${path} → stray '${key}' outside responses`);
      }
    }
  }
  assert.deepEqual(violations, [], 'misplaced status keys break OpenAPI 3.1 validation');

  // The 429 that motivated #885 must now live inside compute's responses.
  const compute429 = spec.paths['/api/compute']?.get?.responses?.['429'];
  assert.ok(compute429, "GET /api/compute must declare '429' inside responses");
});
