import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSimMultiplier } from './urlState.js';

// urlState reads window.location.search — stub a minimal window per case.
function withSearch(search, fn) {
  globalThis.window = { location: { search }, history: { replaceState() {} } };
  try {
    fn();
  } finally {
    delete globalThis.window;
  }
}

test('readSimMultiplier accepts instant and positive numbers', () => {
  withSearch('?sim=instant', () => assert.equal(readSimMultiplier(), 'instant'));
  withSearch('?sim=5', () => assert.equal(readSimMultiplier(), 5));
  withSearch('', () => assert.equal(readSimMultiplier(), 1));
});

test('readSimMultiplier falls back to 1x for zero/negative/garbage (#1040)', () => {
  // sim=0 previously froze /embed mid-prefill and silently upgraded to 1x on /
  withSearch('?sim=0', () => assert.equal(readSimMultiplier(), 1));
  // sim=-5 previously ran the sim clock backwards forever
  withSearch('?sim=-5', () => assert.equal(readSimMultiplier(), 1));
  withSearch('?sim=abc', () => assert.equal(readSimMultiplier(), 1));
});
