// #596 — resolveLmxRestoreStatus(): a bare ?preset=lmx:<id> is not a
// self-contained config; these helpers classify the restore lifecycle so it
// can be surfaced as data-lmx-status instead of silently running default
// RTX 4090 EXL2 speeds under an lmx: label.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLmxRestoreStatus, applyLmxStatusAttr, lmxStatusHint } from './lmxRestoreState.js';

test('#596: non-lmx presets are inactive', () => {
  assert.equal(resolveLmxRestoreStatus({ presetId: 'rtx4090_exl2' }), 'inactive');
  assert.equal(resolveLmxRestoreStatus({ presetId: '' }), 'inactive');
  assert.equal(resolveLmxRestoreStatus({}), 'inactive');
});

test('#596: lmx preset with unloaded runs is pending (fetch still in flight)', () => {
  assert.equal(resolveLmxRestoreStatus({
    presetId: 'lmx:run1', fetchFailed: false, runsLoaded: false, runFound: false
  }), 'pending');
});

test('#596: dataset loaded but run id absent is not_found', () => {
  assert.equal(resolveLmxRestoreStatus({
    presetId: 'lmx:doesnotexist', fetchFailed: false, runsLoaded: true, runFound: false
  }), 'not_found');
});

test('#596: fetch failure is error even before the run could be looked up', () => {
  assert.equal(resolveLmxRestoreStatus({
    presetId: 'lmx:run1', fetchFailed: true, runsLoaded: false, runFound: false
  }), 'error');
});

test('#596: found run is applied', () => {
  assert.equal(resolveLmxRestoreStatus({
    presetId: 'lmx:run1', fetchFailed: false, runsLoaded: true, runFound: true
  }), 'applied');
});

test('#596: attribute helper no-ops on missing shell, sets when present', () => {
  assert.equal(applyLmxStatusAttr(null, 'applied'), false);
  const el = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }
  };
  assert.equal(applyLmxStatusAttr(el, 'not_found'), true);
  assert.equal(el.attrs['data-lmx-status'], 'not_found');
});

test('#596: hints exist for not_found and error only', () => {
  assert.ok(lmxStatusHint('not_found', 'x').includes('lmx:x'));
  assert.ok(lmxStatusHint('error', 'x').includes('default preset speeds'));
  assert.equal(lmxStatusHint('applied', 'x'), null);
  assert.equal(lmxStatusHint('pending', 'x'), null);
  assert.equal(lmxStatusHint('inactive', 'x'), null);
});
