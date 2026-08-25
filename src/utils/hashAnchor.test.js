// Issue #589: hash deep links must move focus (not just scroll), react to
// same-document hashchange, and skip smooth animation under reduced motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollToHashAnchor, prefersReducedMotion } from './hashAnchor.js';

function fakeElement() {
  return {
    tabindex: null,
    focused: false,
    focusOptions: null,
    scrolledWith: null,
    hasAttribute(name) { return this.tabindex !== null && name === 'tabindex'; },
    setAttribute(name, v) { if (name === 'tabindex') this.tabindex = v; },
    focus(opts) { this.focused = true; this.focusOptions = opts; },
    scrollIntoView(opts) { this.scrolledWith = opts; }
  };
}

function fakeDoc(elements) {
  return { getElementById: (id) => elements[id] || null };
}

test('scrolls AND moves focus onto the target (#589 point 1)', () => {
  const el = fakeElement();
  const returned = scrollToHashAnchor('#theory-prefill', fakeDoc({ 'theory-prefill': el }));
  assert.equal(returned, el);
  assert.deepEqual(el.scrolledWith, { behavior: 'smooth', block: 'start' });
  assert.equal(el.focused, true);
  assert.equal(el.focusOptions?.preventScroll, true);
});

test('adds tabindex=-1 to targets that lack it so focus can land', () => {
  const el = fakeElement();
  scrollToHashAnchor('theory-decode', fakeDoc({ 'theory-decode': el }));
  assert.equal(el.tabindex, '-1');
});

test('preserves an existing tabindex on the target', () => {
  const el = fakeElement();
  el.tabindex = '0';
  scrollToHashAnchor('x', fakeDoc({ x: el }));
  assert.equal(el.tabindex, '0');
  assert.equal(el.focused, true);
});

test('returns null for empty hash or unknown anchor without throwing', () => {
  const doc = fakeDoc({});
  assert.equal(scrollToHashAnchor('', doc), null);
  assert.equal(scrollToHashAnchor('#nope', doc), null);
  assert.equal(scrollToHashAnchor('#nope', null), null);
});

test('prefers-reduced-motion switches scroll behavior from smooth to auto', () => {
  assert.equal(prefersReducedMotion(undefined), false);
  const fakeWin = { matchMedia: (q) => ({ matches: q.includes('reduce') }) };
  assert.equal(prefersReducedMotion(fakeWin), true);
});
