// Regression tests for #758 — i18n coverage signal.
// The ar locale ships only 10 of en's namespaces; createTranslator silently
// falls back to English. These tests pin the new localeCoverage() helper and
// the real-registry getCoverage() export so the fallback stays detectable.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { localeCoverage } from './translate.js';
import { getCoverage, setLocale, getLocale } from './strings.js';

test('localeCoverage reports translated vs fallback namespaces', () => {
  const locales = {
    en: { common: {}, header: {}, theory: {} },
    ar: { common: {} }
  };
  const cov = localeCoverage(locales, 'ar');
  assert.equal(cov.locale, 'ar');
  assert.deepEqual(cov.translated, ['common']);
  assert.deepEqual(cov.fallback, ['header', 'theory']);
  assert.equal(cov.partial, true);
});

test('localeCoverage: a complete locale is not partial; unknown locale resolves to en', () => {
  const locales = {
    en: { common: {}, header: {} },
    full: { common: {}, header: {} }
  };
  assert.deepEqual(localeCoverage(locales, 'full'), {
    locale: 'full',
    translated: ['common', 'header'],
    fallback: [],
    partial: false
  });
  // Unknown locale falls back to the en registry → not partial.
  const cov = localeCoverage(locales, 'zz');
  assert.equal(cov.partial, false);
});

test('getCoverage on the REAL registry: en is complete, ar is partial with theory/plainLanguage in fallback (#758)', () => {
  setLocale('en');
  const enCov = getCoverage();
  assert.equal(enCov.locale, 'en');
  assert.equal(enCov.partial, false);
  assert.deepEqual(enCov.fallback, []);

  setLocale('ar');
  const arCov = getCoverage();
  assert.equal(arCov.locale, 'ar');
  assert.equal(arCov.partial, true);
  // The content-heavy namespaces named in #758 must be reported as fallback.
  for (const ns of ['theory', 'plainLanguage', 'singleTurn', 'agentic']) {
    assert.ok(arCov.fallback.includes(ns), `expected '${ns}' in ar fallback list`);
    assert.ok(!arCov.translated.includes(ns), `'${ns}' must not be listed as translated`);
  }
  // And every translated namespace really exists in the ar registry.
  assert.ok(arCov.translated.length > 0);
  assert.equal(arCov.translated.length + arCov.fallback.length, enCov.translated.length);
  setLocale('en');
  assert.equal(getLocale(), 'en');
});
