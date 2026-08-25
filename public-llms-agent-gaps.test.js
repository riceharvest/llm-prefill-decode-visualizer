/**
 * Agent-facing documentation gap guards in /llms.txt (public/llms.txt).
 *
 * Covers three previously-undocumented surfaces that agents could only learn
 * by reverse-engineering the bundle or by being locked out at the edge:
 *   - #671: the global PREFILL/DECODE speed values have a different meaning
 *     per tab (single-turn rate vs agentic new-tokens-only vs batching
 *     step-time floor vs API B^-0.25 decay);
 *   - #674: the share-link generation recipe (title= param + #s/<slug>
 *     fragment + slug algorithm) was documented nowhere;
 *   - #672/#677: platform-level Vercel challenge 403s were undocumented —
 *     no recognition signal, no recovery guidance, no exempt-client classes,
 *     no pointer to owner-side mitigations.
 *
 * The docs must stay accurate against the code they describe, so the slug
 * example is cross-checked against src/utils/permalink.js and the batching
 * step-duration claim against src/utils/batchScheduling.js's documented
 * max() rule and api/_math.js batched().
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const llmsTxt = readFileSync(join(root, 'public', 'llms.txt'), 'utf8');
const llmsFull = readFileSync(join(root, 'public', 'llms-full.txt'), 'utf8');

function section(doc, heading) {
  const start = doc.indexOf(heading);
  if (start === -1) return null;
  const next = doc.slice(start + heading.length).search(/^## /m);
  return next === -1 ? doc.slice(start) : doc.slice(start, start + heading.length + next);
}

// --- #671: global speed controls semantics -------------------------------

test('llms.txt documents that global speed controls mean different things per tab', () => {
  const s = section(llmsTxt, '### Global speed controls');
  assert.ok(s, 'missing "### Global speed controls" section in public/llms.txt');
  assert.match(s, /singleTurn/);
  // Agentic + prefix caching: prefill applies to NEW tokens only on later turns.
  assert.match(s, /toolOutputTokensPerTurn/, 'must state agentic prefill covers only new tokens when caching is on');
  // Batching UI: decode is a step-time floor via max(decodeStepTime, chunkTime).
  assert.match(s, /max\(1000\/decodeSpeed, chunkTokens\/prefillSpeed\)/, 'must document batching step-time floor formula');
  // API batched model: B^-0.25 decay, intentionally different from the UI sim.
  assert.match(s, /\^-0\.25/, 'must document batched per-user decode decay exponent');
});

test('speed-controls section matches the actual math implementations', () => {
  const mathSrc = readFileSync(join(root, 'api', '_math.js'), 'utf8');
  const batchSrc = readFileSync(join(root, 'src', 'utils', 'batchScheduling.js'), 'utf8');
  assert.match(mathSrc, /Math\.pow\(b,\s*-decodeDecayExponent\)/, 'batched decay implementation moved — update doc');
  assert.match(batchSrc, /prefillChunkTime = chunkTokens \/ prefillSpeed/, 'batching step formulas moved — update doc');
  assert.match(mathSrc, /toolOutputTokensPerTurn\s*:\s*totalPromptTokens/, 'agentic prefix-caching branch moved — update doc');
});

test('no endpoint reads or writes live UI slider state (doc claim guard)', () => {
  const appSrc = readFileSync(join(root, 'src', 'App.jsx'), 'utf8');
  assert.doesNotMatch(appSrc, /api\/(speed|sliders)/i, 'a slider-state endpoint appeared — update the speed-controls section');
});

// --- #674: share-link construction recipe --------------------------------

test('llms.txt documents the share-link recipe (title= param + #s/<slug>)', () => {
  const s = section(llmsTxt, '### Building share links programmatically');
  assert.ok(s, 'missing "### Building share links programmatically" section in public/llms.txt');
  assert.match(s, /`title=/, 'must document the title= param');
  assert.match(s, /#s\//, 'must document the #s/<slug> fragment');
  assert.match(s, /80 char/i, 'must document the 80-char slug cap');
  assert.match(s, /&` becomes `and`|`&` → `and`/, 'must document & → and slug rule');
});

test('the documented slug example equals slugifyTitle(title)', async () => {
  const { slugifyTitle } = await import('./src/utils/permalink.js');
  const s = section(llmsTxt, '### Building share links programmatically');
  assert.ok(s);
  // Pull every `#s/<slug>` backtick example and require at least one to be the
  // real slugification of its sibling quoted title.
  const titles = [...s.matchAll(/title `([^`]+)`/g)].map(m => m[1].replace(/"/g, ''));
  const slugs = [...s.matchAll(/#s\/([a-z0-9-]+)`/g)].map(m => m[1]);
  assert.ok(titles.length >= 1 && slugs.length >= 1, 'section must carry an example title + slug pair');
  assert.ok(
    slugs.some(slug => titles.some(t => slugifyTitle(t) === slug)),
    `documented example drifted from slugifyTitle(): got ${JSON.stringify({ titles, slugs })}`,
  );
});

test('permalink implementation still matches the documented shape', async () => {
  const { permalinkHref } = await import('./src/utils/permalink.js');
  const href = permalinkHref(
    { origin: 'https://x.test', pathname: '/', search: '?tab=agentic' },
    'Qwen3 32B Q4 on RTX 4090 & 8K agentic loop',
  );
  assert.match(href, /^https:\/\/x\.test\/\?tab=agentic&title=.*#s\/qwen3-32b-q4-on-rtx-4090-and-8k-agentic-loop$/);
});

// --- #672/#677: edge-challenge documentation ------------------------------

test('llms.txt documents how to recognize a platform-level challenge 403', () => {
  const s = section(llmsTxt, '### Edge challenges');
  assert.ok(s, 'missing "### Edge challenges" section in public/llms.txt');
  assert.match(s, /x-vercel-mitigated: challenge/, 'must name the recognition header');
  assert.match(s, /HTML/i, 'must say the body is HTML, not problem+json');
  assert.match(s, /problem\+json/, 'must contrast with the RFC 9457 error contract');
});

test('llms.txt gives non-burst-retry recovery guidance for challenges', () => {
  const s = section(llmsTxt, '### Edge challenges');
  assert.match(s, /burst-retry/i, 'must warn against burst retrying');
  assert.match(s, /~10 minutes|~10 min/, 'should give expected window duration');
});

test('llms.txt states which clients Vercel exempts and that agents are not', () => {
  const s = section(llmsTxt, '### Edge challenges');
  assert.match(s, /verified bots/i, 'must mention verified-bot exemption');
  assert.match(s, /\(functions, cron jobs\)/i, 'must mention owner internal cron exemption');
  assert.match(s, /not.*exempt/i, 'must state general automated clients are not exempt');
  assert.match(s, /User-Agent spoofing does not help/i, 'must preempt UA spoofing');
});

test('llms.txt points operators at the documented owner-side mitigations', () => {
  const s = section(llmsTxt, '### Edge challenges');
  assert.match(s, /Custom Rule/i, 'must mention scoped custom rules');
  assert.match(s, /bypass/i, 'must mention the bypass action');
  assert.match(s, /System Bypass Rules?/i, 'must mention system bypass rules');
  assert.match(s, /attack-mode|Attack Mode/i, 'must mention attack-mode toggle');
});

test('new sections are present in the compiled llms-full.txt too', () => {
  for (const heading of [
    '### Global speed controls',
    '### Building share links programmatically',
    '### Edge challenges',
  ]) {
    assert.ok(llmsFull.includes(heading), `llms-full.txt is stale — missing ${heading}; run: node scripts/generate-llms-full.mjs`);
  }
});
