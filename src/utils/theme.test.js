import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES,
  THEME_CHANGE_EVENT,
  THEME_URL_PARAM,
  isValidTheme,
  getStoredTheme,
  getUrlTheme,
  resolveInitialTheme,
  applyTheme,
  setTheme,
  getTheme
} from './theme.js';

// Stub the browser globals theme.js touches. The module guards every access,
// so importing it under plain node (no window/document) is safe; these tests
// install minimal fakes to exercise the resolution logic.
function installEnv({ stored = null, contrast = false, light = false, search = '' } = {}) {
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
    location: { search },
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

test('getUrlTheme reads ?theme= and rejects unknown values', () => {
  assert.equal(getUrlTheme(), null);
  installEnv({ search: `?${THEME_URL_PARAM}=high-contrast` });
  assert.equal(getUrlTheme(), 'high-contrast');
  installEnv({ search: `?${THEME_URL_PARAM}=solarized` });
  assert.equal(getUrlTheme(), null);
});

test('resolution order: ?theme= beats stored choice and OS preferences', () => {
  installEnv({ search: '?theme=dark', stored: 'light', contrast: true, light: true });
  assert.equal(resolveInitialTheme(), 'dark');
  installEnv({ search: '?theme=high-contrast', stored: 'light', light: true });
  assert.equal(resolveInitialTheme(), 'high-contrast');
});

test('invalid ?theme= falls through to the normal resolution order', () => {
  installEnv({ search: '?theme=sepia', stored: 'light' });
  assert.equal(resolveInitialTheme(), 'light');
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

// Issue #662: data-theme used to be inert — the shipped CSS had zero
// [data-theme] selectors, so the DOM reported a theme the renderer ignored.
// This pins the attribute to real palette overrides so it can't regress.
test('index.css ships [data-theme] override blocks for every non-dark theme', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../index.css', import.meta.url), 'utf8');
  for (const theme of THEMES) {
    if (theme === 'dark') continue; // dark is the :root default
    assert.match(css, new RegExp(`\\[data-theme='${theme}'\\]`),
      `missing [data-theme='${theme}'] selector`);
  }
});
