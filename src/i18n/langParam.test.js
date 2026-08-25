// Issue #533 — ?lang= locale validation surface.
// isKnownLocale() is the machine-checkable registry query both app shells
// use to report (instead of silently ignoring) unsupported ?lang= values.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKnownLocale, getLocale } from './strings.js';

test('shipped locales are known', () => {
  assert.equal(isKnownLocale('en'), true);
  assert.equal(isKnownLocale('ar'), true);
});

test('unknown / malformed lang values are not known', () => {
  for (const bad of ['zz', 'EN', 'ar-SA', '', null, undefined, 42]) {
    assert.equal(isKnownLocale(bad), false, `expected ${String(bad)} to be unknown`);
  }
});

test('querying the registry never mutates the active locale', () => {
  const before = getLocale();
  isKnownLocale('zz');
  isKnownLocale('ar');
  assert.equal(getLocale(), before);
});
