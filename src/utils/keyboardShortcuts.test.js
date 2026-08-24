import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTypingContext, isInteractiveContext, tabForDigit } from './keyboardShortcuts.js';

const el = (tagName, props = {}) => ({ tagName, isContentEditable: false, getAttribute: (k) => props[k] ?? null, ...props });

test('isTypingContext: form fields and contenteditable (#814)', () => {
  for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) {
    assert.equal(isTypingContext(el(tag)), true, tag);
  }
  assert.equal(isTypingContext({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingContext(el('DIV')), false);
  assert.equal(isTypingContext(null), false);
});

test('isInteractiveContext: buttons, links, ARIA roles — not body/div (#816)', () => {
  assert.equal(isInteractiveContext(el('BUTTON')), true);
  assert.equal(isInteractiveContext(el('A')), true);
  assert.equal(isInteractiveContext(el('SPAN', { role: 'radio' })), true);
  assert.equal(isInteractiveContext(el('DIV', { role: 'option' })), true);
  assert.equal(isInteractiveContext(el('DIV', { role: 'menuitem' })), true);
  assert.equal(isInteractiveContext(el('BUTTON', { role: 'tab' })), true);
  assert.equal(isInteractiveContext(el('BODY')), false);
  assert.equal(isInteractiveContext(el('DIV')), false);
  assert.equal(isInteractiveContext(el('SPAN')), false);
  assert.equal(isInteractiveContext(null), false);
});

const TABS = ['single', 'agentic', 'batching', 'compare', 'ab', 'diff', 'shortlist', 'kvcache', 'theory'];

test('tabForDigit: 1-9 map in order (#822)', () => {
  assert.equal(tabForDigit('1', TABS), 'single');
  assert.equal(tabForDigit('9', TABS), 'theory');
  assert.equal(tabForDigit(5, TABS), 'ab');
});

test('tabForDigit: out-of-range digits yield null instead of undefined tab (#822)', () => {
  // 9 tabs exist; '0' (the would-be 10th view) must be ignored, not map to
  // TABS[9] === undefined which blanked the whole content area.
  assert.equal(tabForDigit('0', TABS), null);
  assert.ok(!('9' in TABS));
  assert.equal(TABS[9], undefined);
  assert.equal(tabForDigit('x', TABS), null);
});
