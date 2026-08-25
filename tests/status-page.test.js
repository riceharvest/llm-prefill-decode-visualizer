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

test('#918: successful poll renders values and primes last-known-good state', async () => {
  const { els } = await runCheck(() => Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(GOOD_PAYLOAD) }));
  assert.match(els['api-status'].innerHTML, /Operational/);
  assert.match(els.freshness.innerHTML, /Fresh/);
  assert.ok(els['last-sync'].textContent.includes('2026'));
  assert.match(els['row-count'].textContent, /1,234|1234/);
  assert.equal(els.headline.textContent, 'All systems operational');
  assert.equal(els.dot.className, 'dot ok');
});

test('#918: HTTP error after a good poll shows "Unknown — API error" and KEEPS last-known-good values', async () => {
  let call = 0;
  const run = await runCheck(() => {
    call += 1;
    if (call === 1) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(GOOD_PAYLOAD) });
    return Promise.resolve({ ok: false, status: 500, text: async () => JSON.stringify({ ok: false }) });
  });
  await run.refresh();
  const { els } = run;
  assert.match(els['api-status'].innerHTML, /Error \(HTTP 500\)/);
  assert.match(els.freshness.innerHTML, /Unknown — API error/);
  // last-known-good retained, NOT rewritten to "never"/"—"
  assert.ok(els['last-sync'].textContent.includes('2026'), 'last-sync keeps previous fetchedAt');
  assert.match(els['row-count'].textContent, /1,234|1234/, 'rowCount kept from last good poll');
  assert.equal(els.headline.textContent, 'API error');
  assert.equal(els.dot.className, 'dot bad');
});

test('#918: first-poll HTTP error never claims "never synced" nor "No data yet"', async () => {
  const { els } = await runCheck(() => Promise.resolve({ ok: false, status: 503, text: async () => 'no body' }));
  assert.notEqual(els['last-sync'].textContent, 'never');
  assert.doesNotMatch(els.freshness.innerHTML, /No data yet/);
  assert.match(els.freshness.innerHTML, /Unknown — API error/);
});

test('#918: non-JSON (WAF challenge) body surfaces as API error, not "unreachable"', async () => {
  const { els } = await runCheck(() => Promise.resolve({ ok: false, status: 403, text: async () => '<html>challenge</html>' }));
  assert.match(els['api-status'].innerHTML, /Error \(HTTP 403\)/);
  assert.match(els.freshness.innerHTML, /Unknown — API error/);
  assert.equal(els.headline.textContent, 'API error');
});

test('#918: network rejection keeps detail rows at last-known-good values', async () => {
  let call = 0;
  const run = await runCheck(() => {
    call += 1;
    if (call === 1) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(GOOD_PAYLOAD) });
    return Promise.reject(new Error('ECONNRESET'));
  });
  await run.refresh();
  const { els } = run;
  assert.equal(els.headline.textContent, 'Unreachable — could not reach the API');
  assert.match(els['api-status'].innerHTML, /Unreachable/);
  // untouched by the failed poll
  assert.ok(els['last-sync'].textContent.includes('2026'));
  assert.match(els.freshness.innerHTML, /Fresh/);
});

test('#918: genuine cold-start payload still renders "No data yet" cold-start copy', async () => {
  const { els } = await runCheck(() => Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, upstreamFreshness: { status: 'empty' } }),
  }));
  assert.match(els.freshness.innerHTML, /No data yet/);
  assert.equal(els.headline.textContent, 'Starting up — no upstream data yet');
});
