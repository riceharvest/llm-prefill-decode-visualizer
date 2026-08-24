// Issue #450: unknown ?tab= deep links must be detectable instead of
// silently falling back to the Single-turn view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTabParam } from './urlState.js';

const TABS = ['single', 'agentic', 'batching', 'compare', 'ab', 'diff', 'shortlist', 'kvcache', 'theory'];

test('resolveTabParam returns a known tab as matched', () => {
  for (const tab of TABS) {
    assert.deepEqual(resolveTabParam(tab, TABS), { tab, matched: true });
  }
});

test('resolveTabParam falls back on an unknown value and flags it (#450)', () => {
  assert.deepEqual(resolveTabParam('bogus', TABS), { tab: 'single', matched: false });
  assert.deepEqual(resolveTabParam('A/B', TABS), { tab: 'single', matched: false });
  assert.deepEqual(resolveTabParam('compare ', TABS), { tab: 'single', matched: false });
  assert.deepEqual(resolveTabParam('Single', TABS), { tab: 'single', matched: false });
});

test('resolveTabParam treats an absent/empty param as matched (plain loads never warn)', () => {
  assert.deepEqual(resolveTabParam(null, TABS), { tab: 'single', matched: true });
  assert.deepEqual(resolveTabParam('', TABS), { tab: 'single', matched: true });
});

test('resolveTabParam honors a custom fallback', () => {
  assert.deepEqual(resolveTabParam('nope', TABS, 'theory'), { tab: 'theory', matched: false });
});
