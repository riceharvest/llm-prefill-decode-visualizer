import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTouchDevice,
  installTouchTooltips,
  __resetTouchTooltipsForTests
} from './touchTooltips.js';

// Minimal browser-global fakes for the module under test. The click listener
// body only runs on real clicks, so the fakes just capture registrations and
// let tests fire media-query changes by hand (#985 regression).
function installEnv({ touch = false } = {}) {
  const state = {
    clickListeners: [],
    changeListeners: []
  };
  globalThis.window = {
    matchMedia(_query) {
      return {
        get matches() { return touch; },
        addEventListener(type, fn) {
          if (type === 'change') state.changeListeners.push(fn);
        },
        removeEventListener() {}
      };
    }
  };
  globalThis.document = {
    addEventListener(type, fn) {
      if (type === 'click') state.clickListeners.push(fn);
    }
  };
  state.flipToTouch = () => {
    touch = true;
    state.changeListeners.forEach((fn) => fn());
  };
  return state;
}

beforeEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  __resetTouchTooltipsForTests();
});

test('isTouchDevice reflects the hover:none/pointer:coarse media query', () => {
  installEnv({ touch: false });
  assert.equal(isTouchDevice(), false);
});

test('installs exactly one click listener when already a touch device', () => {
  const env = installEnv({ touch: true });
  installTouchTooltips();
  installTouchTooltips(); // idempotent
  assert.equal(env.clickListeners.length, 1);
});

test('does not install at mount on non-touch devices but watches for flips (#985)', () => {
  const env = installEnv({ touch: false });
  installTouchTooltips();
  assert.equal(env.clickListeners.length, 0);
  // Device becomes hover-less/coarse after mount -> retry must install.
  env.flipToTouch();
  assert.equal(env.clickListeners.length, 1);
});

test('watcher registers even though first check failed, and fires once (#985)', () => {
  const env = installEnv({ touch: false });
  installTouchTooltips();
  assert.equal(env.changeListeners.length, 1);
  env.flipToTouch();
  env.flipToTouch(); // second flip: already installed, stays idempotent
  assert.equal(env.clickListeners.length, 1);
});
