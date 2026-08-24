// #954: web-font failure signaling. document.fonts.check() lies when
// fonts.googleapis.com is unreachable — the sentinel must detect real
// fallback metrics by measuring rendered widths instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FONT_PROBE_TEXT, measureFontWidth, fontStackApplied,
  detectWebFonts, installFontSentinel
} from './fontFallback.js';

/** Fake DOM whose spans report widths based on whether the family is "web". */
function fakeDoc({ webWidth, fallbackWidth, withFontsApi = true }) {
  const doc = {
    body: { appendChild() {}, },
    documentElement: {
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; }
    },
    createElement() {
      const el = {
        style: {},
        textContent: '',
        remove() {},
        getBoundingClientRect() {
          const css = el.style.cssText || '';
          const isWebStack = css.includes('JetBrains') || css.includes('Inter');
          return { width: isWebStack ? webWidth : fallbackWidth };
        }
      };
      return el;
    }
  };
  if (withFontsApi) doc.fonts = { ready: Promise.resolve() };
  return doc;
}

test('probe text constant is non-trivial and shared', () => {
  assert.ok(FONT_PROBE_TEXT.length >= 16);
});

test('measureFontWidth appends a styled hidden span and removes it', () => {
  const removed = [];
  const doc = fakeDoc({ webWidth: 600, fallbackWidth: 400 });
  // Wrap remove to observe it.
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = (...args) => {
    const el = origCreate(...args);
    el.remove = () => removed.push(el);
    return el;
  };
  const w = measureFontWidth(doc, '"JetBrains Mono", monospace');
  assert.equal(w, 600);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].textContent, FONT_PROBE_TEXT);
  assert.match(removed[0].style.cssText, /visibility:hidden/);
});

test('fontStackApplied threshold: differing widths apply, equal do not', () => {
  assert.equal(fontStackApplied(600, 400), true);
  assert.equal(fontStackApplied(400.3, 400), false);   // rounding noise
  assert.equal(fontStackApplied(NaN, 400), false);
});

test('detectWebFonts reports loaded when any stack measures wider', () => {
  const loaded = fakeDoc({ webWidth: 620, fallbackWidth: 400 });
  assert.equal(detectWebFonts(loaded), 'loaded');
});

test('detectWebFonts reports fallback when metrics are identical (offline)', () => {
  const offline = fakeDoc({ webWidth: 400, fallbackWidth: 400 });
  assert.equal(detectWebFonts(offline), 'fallback');
});

test('detectWebFonts reports unknown without a measurable document', () => {
  assert.equal(detectWebFonts(null), 'unknown');
  assert.equal(detectWebFonts({}), 'unknown');
});

test('installFontSentinel stamps data-web-fonts + warns on fallback', async () => {
  const warnings = [];
  const doc = fakeDoc({ webWidth: 400, fallbackWidth: 400 });
  const state = installFontSentinel(doc, { warn: m => warnings.push(m) });
  await doc.fonts.ready;
  // applySentinel runs asynchronously after fonts.ready — flush microtasks.
  await new Promise(r => setTimeout(r, 0));
  assert.equal(state, 'pending');
  assert.equal(doc.documentElement.attrs['data-web-fonts'], 'fallback');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /fallback/);
});

test('installFontSentinel stays quiet when fonts really loaded', async () => {
  const warnings = [];
  const doc = fakeDoc({ webWidth: 620, fallbackWidth: 400 });
  installFontSentinel(doc, { warn: m => warnings.push(m) });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(doc.documentElement.attrs['data-web-fonts'], 'loaded');
  assert.equal(warnings.length, 0);
});

test('installFontSentinel applies synchronously without the fonts API', () => {
  const doc = fakeDoc({ webWidth: 400, fallbackWidth: 400, withFontsApi: false });
  const state = installFontSentinel(doc, { warn: () => {} });
  assert.equal(state, 'fallback');
  assert.equal(doc.documentElement.attrs['data-web-fonts'], 'fallback');
});
