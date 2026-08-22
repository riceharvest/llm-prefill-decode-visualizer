// i18n core (#78 / #85 / #64) — every user-facing UI string lives in
// ./locales/<locale>/<namespace>.json, one file per namespace (tabs, metric
// labels, theory copy, API error messages, …).
//
// Usage in components:
//   import { t } from '../i18n/strings';
//   t('header.brandTitle')
//   t('speedControls.decodeHint', { tpot: '2.3' })   // {param} interpolation
//
// Adding a locale:
//   1. Create src/i18n/locales/<code>/ mirroring the en/ JSON shape — a
//      partial translation is fine, missing keys fall back to English.
//   2. Set its _meta.json direction to 'rtl' for RTL languages (ar, he, fa…).
//   3. Activate at runtime with setLocale('xx') or the ?lang= URL param;
//      <html lang> and <html dir> follow automatically.
//
// Missing keys fall back to English, then to the key itself, so partial
// translations never render blank UI.

import { createTranslator } from './translate.js';

let localeModules = {};
try {
  localeModules = import.meta.glob('./locales/*/*.json', { eager: true });
} catch {
  // Plain-Node environments (node --test) don't have Vite's glob macro.
  // Load the same JSON files via fs so modules that import this one stay
  // unit-testable. Computed specifiers + @vite-ignore keep node:fs out of
  // browser bundles; in the browser this branch never runs.
  if (typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import(/* @vite-ignore */ 'node:' + 'fs');
    const localesDir = new URL('./locales/', import.meta.url);
    for (const locale of fs.readdirSync(localesDir, { withFileTypes: true })) {
      if (!locale.isDirectory()) continue;
      for (const file of fs.readdirSync(new URL(`./locales/${locale.name}/`, import.meta.url))) {
        if (!file.endsWith('.json')) continue;
        const mod = JSON.parse(fs.readFileSync(new URL(`./locales/${locale.name}/${file}`, import.meta.url), 'utf8'));
        localeModules[`./locales/${locale.name}/${file}`] = { default: mod };
      }
    }
  }
}

const locales = {};
for (const [path, mod] of Object.entries(localeModules)) {
  // path: './locales/<locale>/<namespace>.json'
  const [, , locale, namespaceRaw] = path.split('/');
  const namespace = namespaceRaw.replace(/\.json$/, '');
  if (!locales[locale]) locales[locale] = {};
  const value = mod.default ?? mod;
  if (namespace === '_meta') {
    locales[locale].meta = value;
  } else {
    locales[locale][namespace] = value;

  }
}

const translator = createTranslator(locales, 'en');

export const t = translator.t;
export const tArray = translator.tArray;

/** Switch the active locale and keep <html lang>/<html dir> in sync. */
export function setLocale(locale) {
  translator.setLocale(locale);
  syncDocument();
}

export const getLocale = translator.getLocale;

/** Layout direction for the active locale ('ltr' | 'rtl'). */
export const getDirection = translator.getDirection;

/** Reflect the active locale onto the document: lang + direction. RTL
 *  locales flip the entire layout via [dir='rtl'] CSS logical properties. */
export function syncDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = getLocale();
  document.documentElement.dir = getDirection();
}
