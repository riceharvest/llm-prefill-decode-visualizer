import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALOGY_TERMS,
  ANALOGY_CHANGE_EVENT,
  getAnalogyMode,
  setAnalogyMode
} from './analogies.js';

// Minimal localStorage/window stubs — the real ones only exist in the browser.
let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  };
  globalThis.window = { dispatched: [], dispatchEvent(e) { this.dispatched.push(e); } };
  delete globalThis.CustomEvent;
});

describe('analogy mode', () => {
  test('defaults to off when nothing is stored', () => {
    assert.equal(getAnalogyMode(), false);
  });

  test('setAnalogyMode(true) persists and getAnalogyMode reads it back', () => {
    setAnalogyMode(true);
    assert.equal(getAnalogyMode(), true);
    setAnalogyMode(false);
    assert.equal(getAnalogyMode(), false);
  });

  test('persists under the expected storage key with "1"/"0" flags', () => {
    setAnalogyMode(true);
    assert.equal(store.get('llmpd-analogy-mode'), '1');
    setAnalogyMode(false);
    assert.equal(store.get('llmpd-analogy-mode'), '0');
  });

  test('dispatches a change event carrying the new state', () => {
    // CustomEvent is browser-only; emulate it the way the stubbed window sees it.
    globalThis.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } };
    setAnalogyMode(true);
    const evt = window.dispatched.at(-1);
    assert.equal(evt.type, ANALOGY_CHANGE_EVENT);
    assert.equal(evt.detail.on, true);
  });

  test('survives missing storage and window (private mode / SSR)', () => {
    delete globalThis.localStorage;
    delete globalThis.window;
    assert.doesNotThrow(() => setAnalogyMode(true));
    assert.equal(getAnalogyMode(), false);
  });

  test('registry covers the issue terms', () => {
    assert.deepEqual(ANALOGY_TERMS, ['prefill', 'decode', 'prefixCaching', 'kvCache']);
  });
});
