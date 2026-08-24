import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNum } from './formatNumber.js';

test('formatNum pins en-US grouping regardless of host locale (#735)', () => {
  assert.equal(formatNum(4096), '4,096');
  assert.equal(formatNum(2048), '2,048');
  assert.equal(formatNum(1234567), '1,234,567');
});

test('formatNum keeps fraction digits stable (mirrors default toLocaleString)', () => {
  assert.equal(formatNum(14200.5), '14,200.5');
  assert.equal(formatNum(0.75), '0.75');
});

test('formatNum documents WHY pinning matters: same number, different locales', () => {
  // The old code called .toLocaleString() with no locale, so this exact value
  // rendered "4,096" on en-US hosts but "4.096" on de-DE hosts — breaking the
  // exporters' byte-identical contract. The pinned path never varies:
  assert.equal(formatNum(4096), formatNum(4096, 'en-US'));
  assert.notEqual(formatNum(4096, 'de-DE'), formatNum(4096, 'en-US'));
});

test('formatNum passes non-finite values through unchanged', () => {
  assert.equal(formatNum(NaN), String(NaN));
  assert.equal(formatNum(undefined), String(undefined));
});
