import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Functional tests with a mocked window/localStorage for the URL-addressable
// client surfaces (#638 plain/analogy modes, #644 demoUrl param preservation).
// The modules read `window.location.search` / localStorage lazily inside
// try/catch, so injecting globals here exercises the real code paths.

test('#638 ?plain=1 forces plain-language mode on regardless of storage', async () => {
  const { getPlainMode } = await import('./plainLanguage.js');
  const prevWindow = globalThis.window;
  const prevStorage = globalThis.localStorage;
  try {
    globalThis.window = { location: { search: '?tab=theory&plain=1' } };
    // Storage says OFF — the URL override must win.
    let stored = null;
    globalThis.localStorage = {
      getItem: () => stored,
      setItem: (_k, v) => { stored = v; }
    };
    assert.equal(getPlainMode(), true);

    globalThis.window.location.search = '?plain=0';
    stored = '1'; // storage says ON — explicit ?plain=0 must win
    assert.equal(getPlainMode(), false);
  } finally {
    globalThis.window = prevWindow;
    globalThis.localStorage = prevStorage;
  }
});

test('#638 ?analogy=1 forces analogy mode on regardless of storage', async () => {
  const { getAnalogyMode } = await import('./analogies.js');
  const prevWindow = globalThis.window;
  const prevStorage = globalThis.localStorage;
  try {
    globalThis.window = { location: { search: '?tab=theory&analogy=true' } };
    globalThis.localStorage = { getItem: () => null };
    assert.equal(getAnalogyMode(), true);

    globalThis.window.location.search = '?tab=theory';
    assert.equal(getAnalogyMode(), false); // falls back to storage (unset)
  } finally {
    globalThis.window = prevWindow;
    globalThis.localStorage = prevStorage;
  }
});

test('#644 demoUrl preserves active query params (?lang= included)', async () => {
  const { demoUrl } = await import('./urlState.js');
  const prevWindow = globalThis.window;
  try {
    globalThis.window = {
      location: { pathname: '/', search: '?lang=ar&tab=theory' }
    };
    const url = demoUrl({ tab: 'single', preset: 'rpi5' });
    assert.ok(url.includes('lang=ar'), 'lang must survive demo navigation');
    assert.ok(url.includes('preset=rpi5'), 'demo params present');
    assert.ok(url.includes('autoplay=1'), 'autoplay still set');
    assert.ok(url.startsWith('/?'), 'single ? separator');

    // Demo params win on conflict.
    const conflict = demoUrl({ tab: 'agentic' });
    assert.ok(conflict.includes('tab=agentic'));
    assert.ok(conflict.includes('lang=ar'));

    // No active params → clean URL without trailing '?'.
    globalThis.window.location.search = '';
    const bare = demoUrl({ tab: 'single' });
    assert.equal(bare, '/?tab=single&autoplay=1');
  } finally {
    globalThis.window = prevWindow;
  }
});
