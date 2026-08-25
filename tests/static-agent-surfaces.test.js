// Issues #663 + #665 — locale-independent status page rendering and the
// trailing-slash rewrite for /compare/* pages.
//
// Both are static-contract tests: they pin source invariants that the live
// site depends on (status.html must never render visitor-locale timestamps;
// vercel.json must route slashed /compare/* URLs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('status.html renders no visitor-locale timestamps (#663)', () => {
  const html = readFileSync(`${root}public/status.html`, 'utf8');
  assert.ok(!html.includes('.toLocaleString()'), 'bare toLocaleString removed');
  assert.ok(!html.includes('.toLocaleDateString()'), 'no toLocaleDateString');
  // ISO rendering helper present and used for both dynamic timestamps.
  assert.ok(html.includes('function setIsoTime'), 'setIsoTime helper exists');
  assert.ok(html.includes("setIsoTime('last-sync'"), 'last-sync uses setIsoTime');
  assert.ok(html.includes("setIsoTime('checked-at'"), 'checked-at uses setIsoTime');
  // Machine-readable ISO kept on the <time> element.
  assert.ok(html.includes("t.setAttribute('datetime', text)"), '<time datetime> carries raw ISO');
  assert.ok(html.includes("data-iso"), 'data-iso attribute carries raw ISO');
});

test('status.html renders row counts ungrouped (locale-independent) (#663)', () => {
  const html = readFileSync(`${root}public/status.html`, 'utf8');
  assert.ok(!html.includes('.toLocaleString('), 'no toLocaleString anywhere');
  assert.match(html, /rowCount != null \? String\(f\.rowCount\)/, 'counts via String(n)');
});

test('vercel.json routes trailing-slash /compare/* URLs (#665)', () => {
  const cfg = JSON.parse(readFileSync(`${root}vercel.json`, 'utf8'));
  const sources = (cfg.rewrites || []).map(r => r.source);
  const dests = new Set((cfg.rewrites || []).filter(r => r.destination === '/compare.html').map(r => r.source));
  assert.ok(sources.includes('/compare/:a-vs-:b'), 'unslashed compare rewrite intact');
  assert.ok(dests.has('/compare/:a-vs-:b/'), 'slashed /compare/:a-vs-:b/ rewrite present');
});
