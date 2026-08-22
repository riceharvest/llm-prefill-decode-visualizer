import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RTL_LANGUAGES, lookup, interpolate, resolveDirection, createTranslator
} from './translate.js';

const locales = {
  en: {
    meta: { name: 'English', direction: 'ltr' },
    header: { title: 'Visualizer', hint: 'TPOT = {tpot} ms/tok' },
    list: ['a', 'b'],
    deep: { nested: { key: 'found' } }
  },
  ar: {
    meta: { name: 'العربية', direction: 'rtl' },
    header: { title: 'المُصوِّر' }
  }
};

test('lookup resolves dotted paths and returns undefined for missing ones', () => {
  assert.equal(lookup(locales.en, 'deep.nested.key'), 'found');
  assert.equal(lookup(locales.en, 'header.title'), 'Visualizer');
  assert.equal(lookup(locales.en, 'nope.missing'), undefined);
  assert.equal(lookup(null, 'x'), undefined);
});

test('interpolate replaces {params} and leaves unknown placeholders intact', () => {
  assert.equal(interpolate('TPOT = {tpot} ms/tok', { tpot: '2.3' }), 'TPOT = 2.3 ms/tok');
  assert.equal(interpolate('{a} + {b}', { a: 1 }), '1 + {b}');
  assert.equal(interpolate('no params', { a: 1 }), 'no params');
});

test('resolveDirection maps RTL language bases and respects region subtags', () => {
  assert.equal(resolveDirection('ar'), 'rtl');
  assert.equal(resolveDirection('he'), 'rtl');
  assert.equal(resolveDirection('fa-IR'), 'rtl');
  assert.equal(resolveDirection('en'), 'ltr');
  assert.equal(resolveDirection('pt-BR'), 'ltr');
  assert.equal(resolveDirection(''), 'ltr');
  assert.ok(RTL_LANGUAGES.has('ur'));
});

test('t falls back current locale → English → key itself', () => {
  const { t, setLocale } = createTranslator(locales, 'en');
  assert.equal(t('header.title'), 'Visualizer');
  assert.equal(t('header.hint', { tpot: 5 }), 'TPOT = 5 ms/tok');
  setLocale('ar');
  assert.equal(t('header.title'), 'المُصوِّر');
  // missing in ar → English fallback
  assert.equal(t('header.hint', { tpot: 5 }), 'TPOT = 5 ms/tok');
  // missing everywhere → the key
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('tArray prefers a complete localized array, else English, else empty', () => {
  const { tArray, setLocale } = createTranslator(locales, 'en');
  assert.deepEqual(tArray('list'), ['a', 'b']);
  setLocale('ar');
  assert.deepEqual(tArray('list'), ['a', 'b']);
  assert.deepEqual(tArray('missing'), []);
});

test('setLocale ignores unknown locales and getDirection follows the active one', () => {
  const { setLocale, getLocale, getDirection } = createTranslator(locales, 'en');
  setLocale('zz');
  assert.equal(getLocale(), 'en');
  setLocale('ar');
  assert.equal(getLocale(), 'ar');
  assert.equal(getDirection(), 'rtl');
  setLocale('en');
  assert.equal(getDirection(), 'ltr');
});

test('createTranslator falls back to en when the initial locale is unknown', () => {
  const { getLocale } = createTranslator(locales, 'zz');
  assert.equal(getLocale(), 'en');
});
