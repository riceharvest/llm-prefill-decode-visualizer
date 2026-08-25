// Tests for the /compare 404 edge middleware (issues #757/#759).
//
// The middleware validates both slugs of /compare/:a-vs-:b against the
// build-time manifest and answers unknown pairs with a real HTTP 404.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import middleware, { _resetManifestCache } from './middleware.js';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(root, 'public', 'compare-hardware-slugs.json'), 'utf8'),
);

function requestFor(pathname) {
  return new Request(`https://llm-prefill-decode-visualizer.vercel.app${pathname}`);
}

function withManifestFetch() {
  return mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => manifest,
  }));
}

// Each test gets a fresh manifest memo so mocked fetches actually run.
test.beforeEach(() => { _resetManifestCache(); });
test.afterEach(() => { _resetManifestCache(); });

test('middleware returns a real HTTP 404 for nonexistent hardware pairs (#759)', async () => {
  const f = withManifestFetch();
  try {
    const res = await middleware(requestFor('/compare/totally-fake-gpu-vs-another-fake-one'));
    assert.ok(res instanceof Response, 'expected a Response for an unknown pair');
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    const html = await res.text();
    assert.match(html, /noindex/);
    assert.match(html, /totally-fake-gpu/);
  } finally {
    f.mock.restore();
  }
});

test('middleware falls through (no Response) for known pairs', async () => {
  const [a, b] = manifest.slugs.slice(0, 2);
  const f = withManifestFetch();
  try {
    const res = await middleware(requestFor(`/compare/${a}-vs-${b}`));
    assert.equal(res, undefined, 'known pairs must continue to compare.html untouched');
  } finally {
    f.mock.restore();
  }
});

test('middleware fails open when the manifest is unavailable', async () => {
  const f = mock.method(globalThis, 'fetch', async () => ({ ok: false, json: async () => ({}) }));
  try {
    const res = await middleware(requestFor('/compare/totally-fake-gpu-vs-another-fake-one'));
    assert.equal(res, undefined, 'manifest outage must not hard-block compare pages');
  } finally {
    f.mock.restore();
  }
});

test('middleware ignores non-compare paths and non-GET methods', async () => {
  const f = withManifestFetch();
  try {
    assert.equal(await middleware(requestFor('/')), undefined);
    assert.equal(await middleware(requestFor('/compare/not-a-pair')), undefined);
    const post = new Request('https://example.com/compare/totally-fake-gpu-vs-another-fake-one', { method: 'POST' });
    assert.equal(await middleware(post), undefined);
    assert.equal(f.mock.callCount(), 0, 'must not fetch the manifest for ignored requests');
  } finally {
    f.mock.restore();
  }
});

test('committed slug manifest is well-formed (#757)', () => {
  assert.ok(Array.isArray(manifest.slugs) && manifest.slugs.length >= 10);
  assert.equal(manifest.count, manifest.slugs.length);
  // sorted + unique so the file diffs cleanly between builds
  assert.deepEqual(manifest.slugs, [...new Set(manifest.slugs)].sort());
  // every slug must be in canonical slug form (lowercase alphanumerics/dashes)
  for (const s of manifest.slugs) {
    assert.match(s, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `non-canonical slug in manifest: ${s}`);
  }
});
