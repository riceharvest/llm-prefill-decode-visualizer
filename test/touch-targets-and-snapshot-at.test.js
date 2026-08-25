import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveSnapshotAt } from '../api/_freshness.js';

// ---- resolveSnapshotAt (#826) ---------------------------------------------

test('max_age is evaluated at the dataset instant, not the wall clock (#826)', () => {
  const fetchedAt = new Date(Date.now() - 30 * 86400000); // dataset 30 days old
  const snapshotAt = resolveSnapshotAt({ createdAt: fetchedAt.toISOString() }, new Date('2030-01-01'));
  assert.equal(snapshotAt.getTime(), fetchedAt.getTime(), 'snapshot.createdAt wins');
});

test('falls back only when no snapshot metadata exists', () => {
  const fb = new Date('2026-01-01T00:00:00Z');
  assert.equal(resolveSnapshotAt(null, fb), fb);
  assert.equal(resolveSnapshotAt({}, fb), fb);
});

// ---- coarse-pointer touch targets (#831): CSS contract --------------------

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.css'), 'utf8');

function coarseBlock() {
  const start = css.indexOf('@media (pointer: coarse)');
  assert.ok(start !== -1, 'pointer:coarse block exists');
  // naive brace matching from the block start
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(start, i + 1); }
  }
  throw new Error('unterminated media block');
}

test('coarse-pointer block covers selects, collapse heads and summaries (#831)', () => {
  const block = coarseBlock();
  for (const sel of ['select', '.collapse-head', 'summary']) {
    assert.ok(block.includes(sel), `${sel} covered by 44px rule`);
  }
  assert.ok(block.includes('min-height: 44px'), '44px standard enforced');
});

test('shortlist source-run links get an expanded hit area (#831)', () => {
  const block = coarseBlock();
  assert.ok(block.includes('.source-link'), '.source-link styled in coarse block');
  assert.ok(/\.source-link::after\s*\{[^}]*inset:\s*-13px/.test(block), 'pseudo-element hit-area expansion');
});
