// #950: duplicate query-key precedence. firstValidParam validates BEFORE
// dedup so a leading junk value no longer discards a valid duplicate
// (?tab=bogus&tab=diff must land on 'diff', not fall back to the default).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paramValues, firstValidParam } from './urlState.js';

const TABS = ['single', 'agentic', 'batching', 'compare', 'ab', 'diff', 'shortlist', 'kvcache', 'theory'];
const isTab = v => TABS.includes(v);

test('paramValues returns every occurrence in query order', () => {
  assert.deepEqual(
    paramValues('?tab=diff&tab=agentic', 'tab'),
    ['diff', 'agentic']
  );
  assert.deepEqual(paramValues('?tab=single', 'tab'), ['single']);
  assert.deepEqual(paramValues('?other=1', 'tab'), []);
});

test('first valid occurrence wins: ?tab=bogus&tab=diff → diff (#950 regression)', () => {
  assert.equal(firstValidParam('?tab=bogus&tab=diff', 'tab', isTab), 'diff');
});

test('leading valid value keeps first-wins precedence', () => {
  assert.equal(firstValidParam('?tab=diff&tab=agentic', 'tab', isTab), 'diff');
});

test('junk in later positions is skipped, not returned', () => {
  assert.equal(firstValidParam('?tab=kvcache&tab=nope&tab=theory', 'tab', isTab), 'kvcache');
});

test('all-invalid duplicates yield null so callers apply their fallback', () => {
  assert.equal(firstValidParam('?tab=bogus&tab=worse', 'tab', isTab), null);
  assert.equal(firstValidParam('', 'tab', isTab), null);
});
