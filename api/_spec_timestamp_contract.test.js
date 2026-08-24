import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './_handlers/spec.js';
import { clampItlTokenCount, MAX_ITL_TOKENS } from '../src/utils/itl.js';

// #937: timestamp formats were never declared on any machine-readable surface.
// The OpenAPI info.description now carries the contract; this pins it so it
// cannot silently disappear again.

function callSpec() {
  const headers = new Map();
  let body = '';
  const res = {
    statusCode: 0,
    setHeader(k, v) { headers.set(String(k).toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    end(chunk) { body += chunk ?? ''; }
  };
  const req = {
    method: 'GET',
    url: '/api/spec',
    headers: { 'x-forwarded-for': `spec-ts-${Math.random()}` },
    socket: { remoteAddress: '127.0.0.1' }
  };
  handler(req, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(body);
}

test('spec declares the ISO 8601 UTC timestamp contract (#937)', () => {
  const spec = callSpec();
  const d = spec.info.description;
  assert.match(d, /Timestamp contract/);
  assert.match(d, /ISO 8601 \/ RFC 3339 UTC/);
  assert.match(d, /2026-08-24T12:00:00\.000Z/);
  assert.match(d, /YYYY-MM-DD/);
});

// #938 companion: the single-turn view's O(outputTokens) ITL sampling is now
// bounded via clampItlTokenCount — pin the ceiling and its edge behavior.
test('clampItlTokenCount bounds output tokens to MAX_ITL_TOKENS (#938)', () => {
  assert.equal(MAX_ITL_TOKENS, 4096);
  assert.equal(clampItlTokenCount(10_000_000), 4096);
  assert.equal(clampItlTokenCount(4097), 4096);
  assert.equal(clampItlTokenCount(512), 512);
  assert.equal(clampItlTokenCount(32.9), 32); // floors
});

test('clampItlTokenCount falls back on garbage/non-positive input', () => {
  assert.equal(clampItlTokenCount(0), 512);
  assert.equal(clampItlTokenCount(-5), 512);
  assert.equal(clampItlTokenCount(NaN), 512);
  assert.equal(clampItlTokenCount('abc'), 512);
  assert.equal(clampItlTokenCount(undefined), 512);
  assert.equal(clampItlTokenCount(0, 256), 256);
});
