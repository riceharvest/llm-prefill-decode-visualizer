import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISMISSAL_STORAGE_KEY,
  latestEntry,
  getDismissedId,
  setDismissedId,
  shouldShowBanner
} from './changelog.js';

// In-memory localStorage stand-in (node:test has no DOM storage).
function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
  return store;
}

test('latestEntry picks the newest date and tolerates malformed entries', () => {
  const entries = [
    { id: 'a', date: '2026-08-20' },
    { id: 'b', date: '2026-08-21' },
    null,
    { id: 'c' } // missing date — feed order fallback
  ];
  assert.equal(latestEntry(entries).id, 'b');
});

test('latestEntry returns null for empty or non-array feeds', () => {
  assert.equal(latestEntry([]), null);
  assert.equal(latestEntry(null), null);
  assert.equal(latestEntry('nope'), null);
});

test('dismissal roundtrips through localStorage keyed by entry id', () => {
  const store = installLocalStorage();
  setDismissedId('2026-08-20-engine-flags');
  assert.equal(store.get(DISMISSAL_STORAGE_KEY), '2026-08-20-engine-flags');
  assert.equal(getDismissedId(), '2026-08-20-engine-flags');
});

test('getDismissedId returns null when nothing was dismissed', () => {
  installLocalStorage();
  assert.equal(getDismissedId(), null);
});

test('storage failures never throw', () => {
  globalThis.localStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('full'); }
  };
  assert.equal(getDismissedId(), null);
  assert.doesNotThrow(() => setDismissedId('x'));
  delete globalThis.localStorage;
});

test('shouldShowBanner is true only for an unseen, well-formed entry', () => {
  const entry = { id: 'e1', date: '2026-08-20' };
  assert.equal(shouldShowBanner(entry, null), true);
  assert.equal(shouldShowBanner(entry, 'e1'), false);
  assert.equal(shouldShowBanner(null, null), false);
  assert.equal(shouldShowBanner({ date: '2026-08-20' }, null), false);
});
