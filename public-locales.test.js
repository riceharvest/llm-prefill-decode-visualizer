// #743 — stable locale asset URLs: every i18n namespace ships as static JSON
// at /locales/<lang>/<ns>.json (public/locales/...). Drift guard: the public
// copies must stay byte-identical to src/i18n/locales — regenerate the copies
// when a string changes so agents never read stale theory/glossary text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '.');
const srcLocales = join(root, 'src', 'i18n', 'locales');
const publicLocales = join(root, 'public', 'locales');

function namespaces(lang) {
  return readdirSync(join(srcLocales, lang)).filter(f => f.endsWith('.json'));
}

test('every en namespace is served at /locales/en/<ns>.json (#743)', () => {
  for (const ns of namespaces('en')) {
    const p = join(publicLocales, 'en', ns);
    assert.ok(statSync(p).isFile(), `public/locales/en/${ns} missing`);
  }
});

test('the theory explainer + glossary are fetchable with real content', () => {
  const theory = JSON.parse(readFileSync(join(publicLocales, 'en', 'theory.json'), 'utf8'));
  assert.ok(theory.faq && Array.isArray(theory.faq) && theory.faq.length >= 8,
    'theory.json should carry the full FAQ');
  assert.ok(theory.panelTitle || theory.prefillHeading, 'theory.json missing headings');
  const plain = JSON.parse(readFileSync(join(publicLocales, 'en', 'plainLanguage.json'), 'utf8'));
  assert.ok(Object.keys(plain).length > 0, 'glossary registry empty');
});

test('byte-identical drift guard: public copies ≡ src registries', () => {
  for (const lang of readdirSync(srcLocales)) {
    if (!statSync(join(srcLocales, lang)).isDirectory()) continue;
    for (const ns of namespaces(lang)) {
      const src = readFileSync(join(srcLocales, lang, ns));
      let pubPath = join(publicLocales, lang, ns);
      let pub;
      try {
        pub = readFileSync(pubPath);
      } catch {
        assert.fail(`public/locales/${lang}/${ns} missing — copy it from src/i18n/locales`);
      }
      assert.ok(src.equals(pub), `public/locales/${lang}/${ns} drifted from src — regenerate the copy`);
    }
  }
});
