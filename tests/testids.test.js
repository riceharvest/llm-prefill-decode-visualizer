/**
 * Stable selector-contract guard for agent automation (#641, #791, #795).
 *
 * Guarantees:
 *  - every testid declared in src/utils/testids.js is actually emitted by the
 *    source (no registry entries pointing at deleted markup);
 *  - no mount-order-dependent `useId()` value leaks into any data-* hook
 *    attribute (the ChartDataTable regression that motivated #641);
 *  - the dead GuidedTour component (#791) and its orphaned `data-tour`
 *    attributes stay gone — an emitted hook must not outlive its consumer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { TESTIDS } from '../src/utils/testids.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function collectSrcFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...collectSrcFiles(p));
    else if (/\.(jsx?|html)$/.test(name)) files.push(p);
  }
  return files;
}

const srcFiles = collectSrcFiles(join(root, 'src'));
// The registry file declares the names, so scanning it would make the
// emitter test below trivially true — exclude it.
const emitterFiles = srcFiles.filter(f => !f.endsWith(join('utils', 'testids.js')));
const allSrc = (files) => files.map(f => readFileSync(f, 'utf8')).join('\n');

test('every TESTIDS registry entry is emitted somewhere in src', () => {
  const blob = allSrc(emitterFiles);
  for (const [key, value] of Object.entries(TESTIDS)) {
    // Accept either a direct import of the constant (`TESTIDS.shareButton`)
    // or an inline literal (`data-testid="run-state"`).
    const viaRegistry = blob.includes(`TESTIDS.${key}`);
    const asLiteral = blob.includes(`'${value}'`) || blob.includes(`"${value}"`);
    assert.ok(
      viaRegistry || asLiteral,
      `TESTIDS.${key} ('${value}') has no emitter in src/ — update the registry or restore the markup`,
    );
  }
});

test('no data-* hook value derives from React useId()', () => {
  for (const f of srcFiles) {
    const lines = readFileSync(f, 'utf8').split('\n');
    // Flag any data-*={...} JSX prop whose expression references idPrefix /
    // the useId return on the same line. Aria-only ids are fine; agents must
    // never depend on a renumbering value.
    for (const [i, line] of lines.entries()) {
      assert.ok(
        !(/data-[a-z-]+=\{[^}]*\b(idPrefix|tableId)\b/.test(line)),
        `${f}:${i + 1} exposes a useId()-derived value via a data-* attribute`,
      );
    }
  }
});

test('dead GuidedTour component and orphaned data-tour hooks stay gone (#791)', () => {
  let exists = false;
  try { statSync(join(root, 'src', 'components', 'GuidedTour.jsx')); exists = true; } catch {}
  assert.equal(exists, false, 'GuidedTour.jsx was deleted as dead code; do not resurrect without consumers');
  assert.ok(!allSrc(srcFiles).includes('data-tour'), 'data-tour attributes must not reappear without a live consumer');
});

test('entry-point shell markers exist (#795)', () => {
  const main = readFileSync(join(root, 'src', 'main.jsx'), 'utf8');
  const compareMain = readFileSync(join(root, 'src', 'compare', 'main.jsx'), 'utf8');
  assert.match(main, /dataset\.appShell\s*=\s*isEmbed \? 'embed' : 'main'/);
  assert.match(compareMain, /dataset\.appShell\s*=\s*'compare'/);
});

test('primary controls carry their contract testids', () => {
  const header = readFileSync(join(root, 'src', 'components', 'Header.jsx'), 'utf8');
  const speed = readFileSync(join(root, 'src', 'components', 'SpeedControls.jsx'), 'utf8');
  const chartTable = readFileSync(join(root, 'src', 'components', 'ChartDataTable.jsx'), 'utf8');
  assert.match(header, new RegExp(`data-testid=\\{TESTIDS\\.shareButton\\}`));
  assert.match(header, new RegExp(`data-testid=\\{TESTIDS\\.viewSelect\\}`));
  assert.match(header, new RegExp(`data-testid=\\{TESTIDS\\.hwPreset\\}`));
  assert.match(speed, new RegExp(`data-testid=\\{TESTIDS\\.simToggle\\}`));
  assert.match(speed, new RegExp(`data-testid=\\{TESTIDS\\.prefillRange\\}`));
  assert.match(speed, new RegExp(`data-testid=\\{TESTIDS\\.decodeRange\\}`));
  // ChartDataTable's agent-facing hook must be caption-slug based, never useId.
  assert.match(chartTable, /chartTableTestId\(caption\)/);
});
