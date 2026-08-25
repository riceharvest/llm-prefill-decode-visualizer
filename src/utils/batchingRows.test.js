import { test } from 'node:test';
import assert from 'node:assert/strict';

// #982 — batching timeline request rows must be keyboard-reachable controls:
// the per-request ITL chart was gated behind a pointer-only bare <div>.
const { requestRowA11y, isRowActivateKey } = await import('./batchingRows.js');

test('requestRowA11y exposes button semantics with pressed state', () => {
  const attrs = requestRowA11y({ id: 3 }, true);
  assert.equal(attrs.role, 'button');
  assert.equal(attrs.tabIndex, 0);
  assert.equal(attrs['aria-pressed'], true);
  assert.match(attrs['aria-label'] ?? '', /R3/);
});

test('requestRowA11y: unselected rows announce not-pressed', () => {
  const attrs = requestRowA11y({ id: 1 }, false);
  assert.equal(attrs['aria-pressed'], false);
  assert.doesNotMatch(attrs['aria-label'], /selected/);
});

test('isRowActivateKey accepts Enter and Space only', () => {
  for (const key of ['Enter', ' ', 'Spacebar']) {
    assert.equal(isRowActivateKey({ key }), true, `key=${key} should activate`);
  }
  for (const key of ['Tab', 'Escape', 'ArrowDown', 'a', 'Shift']) {
    assert.equal(isRowActivateKey({ key }), false, `key=${key} must not activate`);
  }
});
