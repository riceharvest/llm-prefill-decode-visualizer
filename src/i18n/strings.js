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
import { localeCoverage } from './coverage.js';
import { getPlainMode } from '../utils/plainLanguage.js';

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

/** True when a locale id has a shipped translation catalog ('en' always). */
export function isKnownLocale(locale) {
  return typeof locale === 'string' && Object.prototype.hasOwnProperty.call(locales, locale);
}

/** Layout direction for the active locale ('ltr' | 'rtl'). */
export const getDirection = translator.getDirection;

const stripMeta = (locale) => {
  const { meta: _meta, ...namespaces } = locale || {};
  return namespaces;
};

/** Translation coverage of the ACTIVE locale vs English (#797): leaf keys
 *  resolving in the locale / total English leaf keys. English → fraction 1. */
export function getCoverage() {
  const current = locales[translator.getLocale()] ? translator.getLocale() : 'en';
  return localeCoverage(stripMeta(locales.en), stripMeta(locales[current]));
}

/** Reflect the active locale onto the document: lang + direction + a
 *  machine-readable coverage signal (data-locale-coverage, percent) so agents
 *  can tell a complete translation from a mostly-English partial one (#797). */
export function syncDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = getLocale();
  document.documentElement.dir = getDirection();
  document.documentElement.dataset.localeCoverage = String(Math.round(getCoverage().fraction * 100));
}

// --- Plain-language mode (#79): rewrite dense jargon using plain equivalents.
const PLAIN_MAP = [
  { short: 'prefill', plain: 'reading the whole prompt first' },
  { short: 'decode', plain: 'writing one word piece at a time' },
  { short: 'TTFT', plain: 'wait before the first word appears' },
  { short: 'TPOT', plain: 'time to write each following word piece' },
  { short: 'GEMM', plain: 'matrix-matrix math step' },
  { short: 'GEMV', plain: 'memory-speed math step' },
  { short: 'KV cache', plain: 'notes on everything read so far' },
  { short: 'prefix caching', plain: 'remembering what was already read' },
  { short: 'VRAM', plain: 'graphics-card memory' },
  { short: 'token', plain: 'word piece' },
  { short: 'compute-bound', plain: 'limited by math speed' },
  { short: 'bandwidth-bound', plain: 'limited by memory speed' }
].sort((a, b) => b.short.length - a.short.length);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite dense jargon in a resolved string using plain equivalents.
 * No-op unless plain-language mode is on.
 */
export function plainify(text) {
  if (typeof text !== 'string' || !text || !getPlainMode()) return text;
  let out = text;
  for (const { short, plain } of PLAIN_MAP) {
    if (!out.toLowerCase().includes(short.toLowerCase())) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(short)}\\b`, 'gi'), (match) =>
      match[0] === match[0].toUpperCase() ? plain.charAt(0).toUpperCase() + plain.slice(1) : plain
    );
  }
  return out;
}

/** t() + plainify() — resolves the key then rewrites jargon if plain-language mode is on. */
export function tPlain(key, params) {
  return plainify(t(key, params));
}
