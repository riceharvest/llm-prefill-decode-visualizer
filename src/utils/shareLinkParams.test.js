/**
 * Tests for the share-link invalid-id helpers (#876).
 *
 * Guarantees:
 *  - absent params are never flagged invalid;
 *  - present-but-unknown ids ARE flagged, with name+value preserved;
 *  - attribute/label formatting is stable for the UI signals;
 *  - warnInvalidParams is silent when nothing is invalid.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findInvalidIdParams,
  invalidParamAttr,
  invalidParamLabel,
  warnInvalidParams
} from './shareLinkParams.js';

const HARDWARE_IDS = ['rtx4090_exl2', 'dual_rtx3090', 'rtx3090_llamacpp', 'mac_ultra', 'rtx3060_entry', 'groq', 'h100', 'rpi5', 'custom'];
const GPU_IDS = ['rtx5090', 'rtx4090', 'rtx3090'];
const WP_IDS = ['fp16', 'q8', 'q4'];

function appReadings(preset) {
  return [{
    name: 'preset',
    value: preset,
    isValid: v => v?.startsWith('lmx:') || HARDWARE_IDS.includes(v)
  }];
}

test('absent or empty params are never flagged invalid', () => {
  for (const v of [null, undefined, '']) {
    assert.deepEqual(findInvalidIdParams(appReadings(v)), []);
  }
});

test('known preset ids and lmx: runs are valid', () => {
  assert.deepEqual(findInvalidIdParams(appReadings('h100')), []);
  assert.deepEqual(findInvalidIdParams(appReadings('lmx:run42')), []);
});

test('unknown preset id is flagged with its original value preserved (#876)', () => {
  assert.deepEqual(
    findInvalidIdParams(appReadings('nvidia_h100')),
    [{ name: 'preset', value: 'nvidia_h100' }]
  );
});

test('kvcache gpu= and wp= unknown ids are flagged', () => {
  const readings = [
    { name: 'gpu', value: 'bogus_gpu', isValid: v => GPU_IDS.includes(v) },
    { name: 'wp', value: 'int24', isValid: v => WP_IDS.includes(v) }
  ];
  assert.deepEqual(
    findInvalidIdParams(readings),
    [{ name: 'gpu', value: 'bogus_gpu' }, { name: 'wp', value: 'int24' }]
  );
});

test('attribute + label formatting is machine/human readable', () => {
  const invalid = [{ name: 'preset', value: 'nvidia_h100' }, { name: 'gpu', value: 'bogus' }];
  assert.equal(invalidParamAttr(invalid), 'preset=nvidia_h100,gpu=bogus');
  assert.equal(invalidParamLabel(invalid), 'preset="nvidia_h100", gpu="bogus"');
  assert.equal(invalidParamAttr([]), '');
});

test('warnInvalidParams stays silent when nothing is invalid', () => {
  const calls = [];
  const fakeWarn = msg => calls.push(msg);
  warnInvalidParams([], fakeWarn);
  warnInvalidParams(null, fakeWarn);
  assert.equal(calls.length, 0);
});

test('warnInvalidParams emits one actionable console.warn', () => {
  const calls = [];
  warnInvalidParams([{ name: 'preset', value: 'nvidia_h100' }], m => calls.push(m));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /unknown id param\(s\): preset="nvidia_h100"/);
  assert.match(calls[0], /\/api\/presets/);
});
