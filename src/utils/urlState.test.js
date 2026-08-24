import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEED_CONTROL_TABS,
  consumesSpeedControls,
  readKvContextLength
} from './urlState.js';

// urlState.js reads window.location.search; install a minimal stub per test.
function setSearch(search) {
  globalThis.window = { location: { search } };
}

beforeEach(() => {
  delete globalThis.window;
});

test('consumesSpeedControls is true only for simulator tabs (#664)', () => {
  assert.deepEqual(SPEED_CONTROL_TABS, ['single', 'agentic', 'batching']);
  for (const tab of SPEED_CONTROL_TABS) {
    assert.equal(consumesSpeedControls(tab), true, tab);
  }
});

test('compare and ab do not consume the speed sliders (#664)', () => {
  assert.equal(consumesSpeedControls('compare'), false);
  assert.equal(consumesSpeedControls('ab'), false);
  // Non-simulator tabs are excluded too.
  assert.equal(consumesSpeedControls('kvcache'), false);
  assert.equal(consumesSpeedControls(undefined), false);
});

test('readKvContextLength prefers the namespaced kvCtx key (#669)', () => {
  setSearch('?kvCtx=131072&ctx=1');
  assert.equal(readKvContextLength(32768), 131072);
});

test('readKvContextLength falls back to legacy numeric ctx= links (#669)', () => {
  setSearch('?ctx=131072');
  assert.equal(readKvContextLength(32768), 131072);
  setSearch('?ctx=8192');
  assert.equal(readKvContextLength(32768), 8192);
});

test('readKvContextLength ignores boolean spellings owned by single-turn (#669)', () => {
  // Repro A of #669: single-turn's toggle writes ctx=1; KV-cache must not
  // load a 1-token context from it.
  for (const bool of ['1', 'true', '0', 'false']) {
    setSearch(`?ctx=${bool}`);
    assert.equal(readKvContextLength(32768), 32768, `ctx=${bool}`);
  }
});

test('readKvContextLength returns fallback on missing or garbage values (#669)', () => {
  setSearch('');
  assert.equal(readKvContextLength(32768), 32768);
  setSearch('?kvCtx=');
  assert.equal(readKvContextLength(32768), 32768);
  setSearch('?ctx=abc');
  assert.equal(readKvContextLength(32768), 32768);
  setSearch('?kvCtx=nope');
  assert.equal(readKvContextLength(32768), 32768);
});
