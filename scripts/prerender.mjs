// Build-time SSR / headless render (agent-readiness follow-up).
//
// Problem: the SPA ships an empty <div id="root"> — crawlers and CLI/LLM
// agents that fetch raw HTML (no JS engine) see nothing but the static
// <noscript> summary. The actual initial chart state only exists after
// client-side hydration.
//
// Fix: after `vite build`, inject a server-rendered snapshot of the initial
// chart state into dist/index.html. The numbers come from the SAME pure math
// core the API uses (api/_handlers/compute.js computeBody) and the same
// preset tables the UI uses (src/utils/presets.js), so the snapshot always
// matches what a JS browser would render for the default view.
//
// When a real browser loads the page, React's createRoot().render() replaces
// the injected block wholesale — zero hydration-diff risk.
//
// Idempotent: the injected block carries data-ssr-initial-state and contains
// no nested <div>s, so re-running strips the previous snapshot first.
// `npm run build` therefore stays safely re-runnable.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeBody } from '../api/_handlers/compute.js';
import { HARDWARE_PRESETS, formatTime } from '../src/utils/presets.js';

const DIST_INDEX = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html');

// The workload the app opens with by default (RAG-shaped: 4k in / 512 out on
// the RTX 4090 preset) — same numbers as the canonical /api/compute example.
const INITIAL_PARAMS = {
  model: 'singleTurn',
  promptTokens: 4096,
  outputTokens: 512,
};

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '∞';
}

/**
 * Render the initial single-turn chart state as a self-contained HTML
 * fragment. Pure: same input → same output, no filesystem/network access.
 * @returns {string} HTML (no nested divs — see idempotency note above)
 */
export function buildInitialStateHtml() {
  const rows = HARDWARE_PRESETS.map((hw) => {
    const { status, body } = computeBody({
      ...INITIAL_PARAMS,
      prefillSpeed: hw.prefillSpeed,
      decodeSpeed: hw.decodeSpeed,
    });
    if (status !== 200 || !body || body.ttftSeconds === undefined) return null;
    return { hw, r: body };
  }).filter(Boolean);

  const headline = rows[0]?.r;
  if (!headline) throw new Error('prerender: no hardware preset produced a result');

  const metric = (label, value) =>
    `<li><strong>${escapeHtml(label)}:</strong> ${value}</li>`;

  return [
    '<section data-ssr-initial-state aria-labelledby="ssr-h">',
    '<h2 id="ssr-h">Initial chart state (server-rendered)</h2>',
    `<p>Default scenario: ${fmt(INITIAL_PARAMS.promptTokens, 0)}-token prompt,` +
      ` ${fmt(INITIAL_PARAMS.outputTokens, 0)} output tokens, computed with the same` +
      ' math as <a href="/api/compute">/api/compute</a>. Numbers update once' +
      ' JavaScript loads; everything below is already final for these inputs.</p>',
    '<ul>',
    metric('TTFT (RTX 4090 preset)', `${formatTime(headline.ttftSeconds)} (${headline.ttftSeconds.toFixed(3)}s)`),
    metric('TPOT', `${headline.tpotMs.toFixed(2)} ms/token`),
    metric('Total walltime', formatTime(headline.totalWalltimeSeconds)),
    metric('Effective throughput', `${fmt(headline.effectiveThroughputTokPerSec, 1)} tok/s`),
    metric('Prefill share of walltime', `${headline.prefillSharePct.toFixed(1)}%`),
    '</ul>',
    '<table>',
    '<caption>TTFT / TPOT per built-in hardware preset for this scenario</caption>',
    '<thead><tr><th>Hardware preset</th><th>Prefill tok/s</th><th>Decode tok/s</th>' +
      '<th>TTFT</th><th>TPOT</th><th>Total</th></tr></thead>',
    '<tbody>',
    rows.map(({ hw, r }) =>
      `<tr><td>${escapeHtml(hw.name)}</td><td>${fmt(hw.prefillSpeed, 0)}</td>` +
      `<td>${fmt(hw.decodeSpeed, 0)}</td><td>${formatTime(r.ttftSeconds)}</td>` +
      `<td>${r.tpotMs.toFixed(2)} ms</td><td>${formatTime(r.totalWalltimeSeconds)}</td></tr>`).join(''),
    '</tbody>',
    '</table>',
    '</section>',
  ].join('');
}

/**
 * Inject (or replace an earlier injection of) the SSR snapshot into built
 * index.html source. Pure string transform — exported for tests.
 * @param {string} html dist/index.html contents
 * @param {string} fragment output of buildInitialStateHtml()
 */
export function injectPrerendered(html, fragment) {
  // Strip any previous snapshot so repeated builds never stack duplicates.
  let out = html.replace(/<section data-ssr-initial-state[\s\S]*?<\/section>\n?/, '');

  const openTagMatch = out.match(/<div id="root"[^>]*>/);
  if (!openTagMatch) {
    throw new Error('prerender: could not find <div id="root"> in dist/index.html');
  }
  const openTag = openTagMatch[0];
  out = out.replace(openTag, `${openTag}\n${fragment}`);
  return out;
}

function main() {
  let html;
  try {
    html = readFileSync(DIST_INDEX, 'utf8');
  } catch {
    console.error(`prerender: ${DIST_INDEX} not found — run \`vite build\` first.`);
    process.exit(1);
  }
  const next = injectPrerendered(html, buildInitialStateHtml());
  if (next === html) {
    console.error('prerender: injection produced no change — unexpected');
    process.exit(1);
  }
  writeFileSync(DIST_INDEX, next);
  console.log('prerender: initial chart state injected into dist/index.html');
}

// Run directly (not under node --test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
