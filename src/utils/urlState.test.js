import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { consumeAutoplay } from './urlState.js';

// urlState reads window.location.search — stub a minimal window per test.
beforeEach(() => {
  globalThis.window = { location: { search: '' } };
});

function withSearch(search) {
  globalThis.window.location.search = search;
}

test('consumeAutoplay consumes ?autoplay=1 exactly once per page load (#818 #693)', () => {
  // absent param → no autoplay, nothing consumed
  withSearch('');
  assert.equal(consumeAutoplay(), false);
  assert.equal(consumeAutoplay(), false);
  // junk value → no autoplay
  withSearch('?autoplay=yes');
  assert.equal(consumeAutoplay(), false);
  // demo link → fires once...
  withSearch('?autoplay=1&tab=single');
  assert.equal(consumeAutoplay(), true);
  // ...second consumer in the same page load (tab switch remounts a
  // simulator) must NOT re-fire autoplay...
  assert.equal(consumeAutoplay(), false);
  // ...and it stays consumed even after the param is gone.
  withSearch('');
  assert.equal(consumeAutoplay(), false);
});
