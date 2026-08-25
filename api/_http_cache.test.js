import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheControlFor } from './_http_cache.js';

// #944: diff/sizing/snapshots stamped `public, max-age=<ttl>` on EVERY status,
// so edge/browser caches replayed 404/502 failures after the cause cleared
// (live-verified: x-vercel-cache: HIT age 45 on a 404). Successes keep their
// documented TTL; errors must be uncacheable.

test('success statuses keep the public TTL', () => {
  assert.equal(cacheControlFor(200, 300), 'public, max-age=300');
  assert.equal(cacheControlFor(200, 600), 'public, max-age=600');
  assert.equal(cacheControlFor(201, 60), 'public, max-age=60');
});

test('error statuses are never cacheable (#944)', () => {
  for (const status of [400, 404, 429, 500, 502]) {
    const cc = cacheControlFor(status, 600);
    assert.equal(cc, 'no-store', `status ${status} must not be publicly cached`);
    assert.ok(!cc.includes('max-age'), 'no max-age on error responses');
  }
});
