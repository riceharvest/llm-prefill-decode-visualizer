import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES,
  THEME_CHANGE_EVENT,
  isValidTheme,
  getStoredTheme,
  resolveInitialTheme,
  applyTheme,
  setTheme,
  getTheme
} from './theme.js';

// Stub the browser globals theme.js touches. The module guards every access,
// so importing it under plain node (no window/document) is safe; these tests
// install minimal fakes to exercise the resolution logic.
function installEnv({ stored = null, contrast = false, light = false } = {}) {
  const map = new Map();
  if (stored !== null) map.set('llmpd-theme', stored);
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
  const queries = {
    '(prefers-contrast: more)': contrast,
    '(prefers-color-scheme: light)': light
  };
  globalThis.matchMedia = (query) => ({
    matches: Boolean(queries[query]),
    addEventListener() {},
    removeEventListener() {}
  });
  const dataset = {};
  const events = [];
  globalThis.document = { documentElement: { dataset } };
  globalThis.CustomEvent = class {
    constructor(type, opts) { this.type = type; this.detail = opts?.detail; }
  };
  globalThis.window = {
    dispatchEvent: (e) => events.push(e)
  };
  return { dataset, events };
}

beforeEach(() => {
  delete globalThis.localStorage;
  delete globalThis.matchMedia;
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.CustomEvent;
});

test('THEMES covers exactly the three shipped palettes', () => {
  assert.deepEqual(THEMES, ['dark', 'light', 'high-contrast']);
});

test('isValidTheme accepts known themes and rejects junk', () => {
  assert.equal(isValidTheme('dark'), true);
  assert.equal(isValidTheme('high-contrast'), true);
  assert.equal(isValidTheme('sepia'), false);
  assert.equal(isValidTheme(undefined), false);
});

test('resolution order: stored choice beats OS preferences', () => {
  installEnv({ stored: 'light', contrast: true, light: true });
  assert.equal(resolveInitialTheme(), 'light');
});

test('resolution order: prefers-contrast: more → high-contrast', () => {
  installEnv({ contrast: true, light: true });
  assert.equal(resolveInitialTheme(), 'high-contrast');
});

test('resolution order: OS color-scheme light → light', () => {
  installEnv({});
  assert.equal(resolveInitialTheme(), 'dark');
  installEnv({ light: true });
  assert.equal(resolveInitialTheme(), 'light');
});

test('corrupted storage values are ignored, not applied', () => {
  installEnv({ stored: 'sepia' });
  assert.equal(getStoredTheme(), null);
  assert.equal(resolveInitialTheme(), 'dark');
});

test('setTheme persists, applies data-theme, and broadcasts an event', () => {
  const { dataset, events } = installEnv({});
  setTheme('high-contrast');
  assert.equal(dataset.theme, 'high-contrast');
  assert.equal(localStorage.getItem('llmpd-theme'), 'high-contrast');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, THEME_CHANGE_EVENT);
  assert.equal(events[0].detail.theme, 'high-contrast');
  assert.equal(getTheme(), 'high-contrast');
});

test('setTheme ignores unknown themes without side effects', () => {
  const { dataset, events } = installEnv({});
  setTheme('solarized');
  assert.equal(dataset.theme, undefined);
  assert.equal(events.length, 0);
});

test('applyTheme writes the attribute but never touches storage', () => {
  const { dataset } = installEnv({ stored: null });
  applyTheme('light');
  assert.equal(dataset.theme, 'light');
  assert.equal(getStoredTheme(), null);
});
