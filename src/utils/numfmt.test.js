import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fmtEn } from './numfmt.js';

test('fmtEn groups digits en-US regardless of host locale (#635)', () => {
  assert.equal(fmtEn(4096), '4,096');
  assert.equal(fmtEn(12345), '12,345');
  assert.equal(fmtEn(1234567), '1,234,567');
  assert.equal(fmtEn(999), '999');
  assert.equal(fmtEn(0), '0');
});

test('fmtEn output always matches the en-US Intl formatter', () => {
  const ref = new Intl.NumberFormat('en-US');
  for (const v of [1, 10, 105, 3800, 65536, 131072, 19800]) {
    assert.equal(fmtEn(v), ref.format(v));
  }
});

test('fmtEn never emits host-locale separators or non-ASCII digits', () => {
  for (const v of [2048, 51200, 1000000]) {
    // en-US: comma group separator, ASCII digits, no NBSP/narrow-NBSP
    assert.match(fmtEn(v), /^\d{1,3}(,\d{3})*$/);
    assert.doesNotMatch(fmtEn(v), /[\u00A0\u202F\u0660-\u0669]/);
  }
});

test('fmtEn passes non-finite sentinels through untouched (∞ stays symbolic)', () => {
  assert.equal(fmtEn(Infinity), 'Infinity');
  assert.equal(fmtEn(NaN), 'NaN');
});
