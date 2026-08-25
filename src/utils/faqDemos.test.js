// Issue #588: FAQ Try-it demos must be bound to theory.faq entries by stable
// id, never by array index. This drift test fails when the demo map and the
// faq content fall out of sync (missing/renamed/reordered entries).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FAQ_DEMOS } from './faqDemos.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const theory = JSON.parse(
  readFileSync(join(root, 'src', 'i18n', 'locales', 'en', 'theory.json'), 'utf8')
);

test('every theory.faq entry carries a stable id', () => {
  const items = theory.faq;
  assert.ok(Array.isArray(items) && items.length > 0);
  for (const item of items) {
    assert.equal(typeof item.id, 'string');
    assert.match(item.id, /^[a-z0-9-]+$/);
  }
});

test('faq ids are unique — no two entries can claim one demo', () => {
  const ids = theory.faq.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('demo map keys resolve to real faq ids (no orphaned demos after edits)', () => {
  const faqIds = new Set(theory.faq.map(f => f.id));
  for (const key of Object.keys(FAQ_DEMOS)) {
    assert.ok(faqIds.has(key), `FAQ_DEMOS key "${key}" has no matching theory.faq entry`);
  }
});

test('every faq entry that should have a demo resolves by key (#588 core contract)', () => {
  for (const item of theory.faq) {
    // All eight current entries ship demos; if a new entry intentionally
    // goes without, add it to the documented exception list here.
    const exceptions = [];
    if (!exceptions.includes(item.id)) {
      assert.ok(FAQ_DEMOS[item.id], `theory.faq entry "${item.id}" has no Try-it demo`);
    }
  }
});
