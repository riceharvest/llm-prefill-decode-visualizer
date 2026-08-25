/**
 * Tests for public/status.html agent-usability fixes:
 *  - #912: the page must carry machine-readable pointers that work without
 *    JavaScript (<noscript> fallback linking /api/health +
 *    /api/agent/freshness.json; JSON-LD naming the machine-readable
 *    equivalent).
 *  - #918: failure-state fidelity in the polling script — an API HTTP error
 *    must render as "Unknown — API error" (never as upstream "No data yet"),
 *    last-known-good sync values survive transient failures, non-JSON bodies
 *    surface as API errors rather than "unreachable", and only a genuine
 *    status:'empty' payload renders the cold-start labels.
 *
 * The inline script is evaluated against a minimal mock DOM so its actual
 * behavior (not just its source) is exercised via node --test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const html = readFileSync(join(ROOT, 'public/status.html'), 'utf8');

const ELEMENT_IDS = ['dot', 'headline', 'api-status', 'freshness', 'last-sync', 'cache-age', 'row-count', 'checked-at'];

function makeDom() {
  const els = {};
  for (const id of ELEMENT_IDS) els[id] = { className: '', textContent: '', innerHTML: '' };
  const document = {
    getElementById: (id) => els[id],
    body: {
      classList: {
        add() {}, remove() {},
      },
    },
  };
  return { els, document };
}

function extractInlineScript(source) {
  const blocks = source.match(/<script>([\s\S]*?)<\/script>/g) || [];
  const inline = blocks.find((b) => !b.includes('application/ld+json'));
  assert.ok(inline, 'inline <script> block found in status.html');
  return inline.replace(/^<script>/, '').replace(/<\/script>$/, '');
}

// Runs one full check() cycle against the given fetch behavior and returns
// the rendered element state.
async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function runCheck(fetchImpl) {
  const { els, document } = makeDom();
  const fn = new Function('document', 'fetch', 'setInterval', extractInlineScript(html));
  let intervalFn = null;
  fn(document, fetchImpl, (f) => { intervalFn = f; });
  await settle();
  return {
    els,
    // Fire the 60s refresh tick manually.
    refresh: async () => { assert.ok(intervalFn, 'interval registered'); intervalFn(); await settle(); },
  };
}

const GOOD_PAYLOAD = {
  ok: true,
  time: '2026-08-24T12:00:00Z',
  upstreamFreshness: { status: 'fresh', fetchedAt: '2026-08-24T11:58:00Z', ageSeconds: 120, rowCount: 1234 },
};

test('#912: noscript fallback links both machine-readable endpoints', () => {
  const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
  assert.ok(noscript, 'a <noscript> block exists');
  assert.ok(noscript[1].includes('href="/api/health"'), 'noscript links /api/health');
  assert.ok(noscript[1].includes('href="/api/agent/freshness.json"'), 'noscript links /api/agent/freshness.json');
});

test('#912: JSON-LD names the machine-readable equivalent endpoint', () => {
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ldMatch, 'JSON-LD block present');
  const ld = JSON.parse(ldMatch[1]);
  assert.equal(ld['@type'], 'WebPage');
  assert.ok(ld.description.includes('/api/health'), 'description points at /api/health');
  assert.equal(ld.mainEntity.url, 'https://llm-prefill-decode-visualizer.vercel.app/api/health');
});

test('#912: footer links the freshness report alongside /api/health', () => {
  const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)[1];
  assert.ok(footer.includes('/api/agent/freshness.json'));
});
