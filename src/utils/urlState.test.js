import { test } from 'node:test';
import assert from 'node:assert/strict';

// Browser-ish globals BEFORE importing urlState (the module reads window at
// call time, not import time).
class MiniCustomEvent extends Event {
  constructor(type, opts) {
    super(type);
    this.detail = opts && opts.detail;
  }
}
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = MiniCustomEvent;
}
const location = { pathname: '/', search: '?prompt=2048' };
const target = new EventTarget();
globalThis.window = Object.assign(target, {
  location,
  history: {
    replaceState(_state, _title, url) {
      const u = new URL(url, 'http://localhost');
      location.pathname = u.pathname;
      location.search = u.search;
    }
  }
});

const { readParam, writeParams, subscribeUrlParams } = await import('./urlState.js');

test('#727: writeParams rewrites the query string', () => {
  writeParams({ prompt: 4096 });
  assert.equal(readParam('prompt'), '4096');
});

test('#727: writeParams notifies subscribers so permalink title can refresh', () => {
  let fired = 0;
  const unsub = subscribeUrlParams(() => { fired++; });
  writeParams({ prompt: 8192 });
  assert.equal(fired, 1);
  writeParams({ output: 1024 });
  assert.equal(fired, 2);
  unsub();
  writeParams({ output: 2048 });
  assert.equal(fired, 2, 'listener unsubscribed');
});

test('#727: deleting a param also notifies subscribers', () => {
  let fired = 0;
  const unsub = subscribeUrlParams(() => { fired++; });
  writeParams({ prompt: '' }); // '' deletes the key
  assert.equal(readParam('prompt'), null);
  assert.equal(fired, 1);
  unsub();
});
