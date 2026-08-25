/**
 * Tests for the generated tab sections in public/llms.txt
 * (scripts/generate-llms-txt.mjs).
 *
 * Guarantees:
 *  - every app tab declared in src/components/Header.jsx MODES has a stable,
 *    agent-parseable `### Tab: <id>` section in /llms.txt;
 *  - the agent-parseable meta block lists exactly those tabs;
 *  - the chronically-stale hand-written tab list is gone;
 *  - regenerating is idempotent (byte-identical output on re-run).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TABS, renderMetaBlock, renderTabSection } from '../scripts/generate-llms-txt.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const llmsTxt = readFileSync(join(root, 'public', 'llms.txt'), 'utf8');
const headerSrc = readFileSync(join(root, 'src', 'components', 'Header.jsx'), 'utf8');

/** Tab ids actually rendered by the UI header (source of truth for the app). */
function extractUiTabIds() {
  const ids = [];
  for (const m of headerSrc.matchAll(/\{\s*id:\s*'([a-z]+)'\s*,\s*label:/g)) {
    ids.push(m[1]);
  }
  return ids;
}

test('generator TABS registry stays in sync with Header.jsx MODES', () => {
  const uiIds = extractUiTabIds();
  assert.ok(uiIds.length >= 5, `expected several UI tabs, found: ${uiIds.join(',')}`);
  assert.deepEqual(
    TABS.map(t => t.id),
    uiIds,
    'scripts/generate-llms-txt.mjs TABS must mirror src/components/Header.jsx MODES order and ids',
  );
});

test('llms.txt contains a stable section per app tab', () => {
  const uiIds = extractUiTabIds();
  for (const id of uiIds) {
    const pattern = new RegExp(`^### Tab: ${id} — .+$`, 'm');
    assert.match(llmsTxt, pattern, `missing "### Tab: ${id}" section in llms.txt`);
  }
});

test('each tab section carries the agent-parseable field set', () => {
  for (const tab of TABS) {
    const section = renderTabSection(tab);
    assert.match(section, /^- Tab-ID: /m);
    assert.match(section, new RegExp(`^- URL: /\\?tab=${tab.id}$`, 'm'));
    assert.match(section, /^- Purpose: \S/m, `tab ${tab.id}: Purpose must be non-empty`);
    assert.match(section, /^- Surfaces: \S/m, `tab ${tab.id}: Surfaces must be non-empty`);
    assert.match(section, /^- Endpoints: /m, `tab ${tab.id}: Endpoints line required`);
  }
});

test('agent-parseable meta block exists and lists all tabs', () => {
  const meta = renderMetaBlock();
  const start = llmsTxt.indexOf('<!-- agent-parseable:meta -->');
  assert.notEqual(start, -1, 'meta block markers missing from llms.txt');
  const end = llmsTxt.indexOf('<!-- /agent-parseable:meta -->', start);
  assert.notEqual(end, -1, 'unterminated meta block in llms.txt');
  const block = llmsTxt.slice(start, end);

  // Same key set and values the generator emits (modulo marker lines).
  for (const line of meta.split('\n')) {
    if (line.startsWith('<!--')) continue;
    if (!line) continue;
    assert.ok(
      block.includes(line.trim()),
      `meta block missing generated line: ${line}`,
    );
  }

  const tabsLine = block.split('\n').find(l => l.startsWith('Tabs:'));
  assert.ok(tabsLine, 'meta block must carry a "Tabs:" line');
  assert.deepEqual(
    tabsLine.slice('Tabs:'.length).trim().split(','),
    TABS.map(t => t.id),
  );
  assert.match(block, /^Base-URL: https:\/\//m);
  assert.match(block, /^OpenAPI-Spec: \/api\/spec$/m);
});

test('stale hand-written tab list was replaced by generated sections', () => {
  // The old prose enumerated only 5 of 9 tabs with a pipe-separated param.
  assert.doesNotMatch(llmsTxt, /\?tab=single\|agentic\|compare\|kvcache\|theory/);
  assert.doesNotMatch(llmsTxt, /### Interactive page/);
  assert.match(llmsTxt, /^## App tabs \(interactive page\)$(?![\s\S]*## App tabs)/m);
});

test('tab deep links reference real URL params used by App.jsx', () => {
  const appSrc = readFileSync(join(root, 'src', 'App.jsx'), 'utf8');
  for (const tab of TABS) {
    assert.match(
      appSrc,
      new RegExp(`['"\`]${tab.id}['"\`]`),
      `App.jsx no longer references tab '${tab.id}' — update scripts/generate-llms-txt.mjs`,
    );
  }
});

test('llms.txt names the authoritative id sources and unknown-id behavior (#876)', () => {
  // The deep-link section must point agents at /api/presets for preset= ids,
  // enumerate the kvcache gpu=/wp= vocabularies, and document that unknown
  // ids are kept in the URL with a visible signal instead of being swapped.
  assert.match(llmsTxt, /GET \/api\/presets[^\n]*`rtx4090_exl2`|`preset=<hardware-id>`[^\n]*\/api\/presets/s);
  assert.match(llmsTxt, /`wp=` takes one of `fp16`, `q8`, `q4`/);
  assert.match(llmsTxt, /never silently swapped/);
  assert.match(llmsTxt, /data-invalid-param/);
});

test('regenerating llms.txt is idempotent (byte-identical output)', () => {
  const before = readFileSync(join(root, 'public', 'llms.txt'), 'utf8');
  execFileSync(process.execPath, [join(root, 'scripts', 'generate-llms-txt.mjs')], {
    cwd: root,
    stdio: 'pipe',
  });
  const after = readFileSync(join(root, 'public', 'llms.txt'), 'utf8');
  assert.equal(after, before, 're-running generate-llms-txt.mjs changed llms.txt');
});
