// Unit tests for the build-time SSR injection (scripts/prerender.mjs).
// The snapshot must contain real computed chart-state numbers that match
// /api/compute exactly, and the injection must be idempotent across builds.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildInitialStateHtml, injectPrerendered } from './prerender.mjs';
import { computeBody } from '../api/_handlers/compute.js';

const SAMPLE_HTML = `<!doctype html>
<html><head><title>test</title></head>
<body>
<noscript>static summary</noscript>
<div id="root" tabindex="-1"></div>
<script type="module" src="/src/main.jsx"></script>
</body></html>`;

test('snapshot contains server-rendered initial chart state matching /api/compute', () => {
  const html = buildInitialStateHtml();

  // Structural markers a crawler/agent can key on.
  assert.match(html, /data-ssr-initial-state/);
  assert.match(html, /Initial chart state/);

  // Numbers must equal the canonical API result for the default scenario.
  const { status, body } = computeBody({
    model: 'singleTurn',
    promptTokens: 4096,
    outputTokens: 512,
    prefillSpeed: 3800,
    decodeSpeed: 105,
  });
  assert.equal(status, 200);
  assert.ok(html.includes(body.ttftSeconds.toFixed(3)), 'TTFT seconds present and exact');
  assert.ok(html.includes(body.tpotMs.toFixed(2)), 'TPOT ms present and exact');
});

test('snapshot includes one table row per built-in hardware preset', () => {
  const html = buildInitialStateHtml();
  const rowCount = (html.match(/<tr><td>/g) || []).length;
  assert.ok(rowCount >= 5, `expected several preset rows, got ${rowCount}`);
  assert.match(html, /RTX 4090 24GB/);
  assert.match(html, /<caption>/);
});

test('injection places snapshot inside #root without touching noscript', () => {
  const out = injectPrerendered(SAMPLE_HTML, '<section data-ssr-initial-state>X</section>');
  assert.match(out, /<div id="root" tabindex="-1">\n<section data-ssr-initial-state>X<\/section>/);
  assert.match(out, /<noscript>static summary<\/noscript>/);
  assert.equal((out.match(/data-ssr-initial-state/g) || []).length, 1);
});

test('injection is idempotent — rebuilding never stacks duplicate snapshots', () => {
  const once = injectPrerendered(SAMPLE_HTML, '<section data-ssr-initial-state>one</section>');
  const twice = injectPrerendered(once, '<section data-ssr-initial-state>two</section>');
  assert.equal((twice.match(/<section data-ssr-initial-state/g) || []).length, 1);
  assert.match(twice, />two</);
});

test('injection throws a clear error when #root is missing', () => {
  assert.throws(() => injectPrerendered('<html></html>', '<section>x</section>'),
    /could not find <div id="root">/);
});
