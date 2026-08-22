// Pure i18n helpers (#78) — no DOM, no Vite specifics, so `node --test` can
// exercise them directly (see translate.test.js).

export const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

/** Look up a dotted key ('header.brandTitle') in a nested dict. */
export function lookup(dict, path) {
  let node = dict;
  for (const part of path.split('.')) {
    if (node === undefined || node === null) return undefined;
    node = node[part];
  }
  return node;
}

/** Replace {param} placeholders in a template string. */
export function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/** Layout direction ('ltr' | 'rtl') for a locale code like 'ar' or 'pt-BR'. */
export function resolveDirection(locale) {
  const base = String(locale || '').split('-')[0];
  return RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr';
}

/**
 * Build the translator API over a locales registry ({ en: {...}, ar: {...} }).
 * Falls back: current locale → English → the key itself, so partial
 * translations never render blank UI.
 */
export function createTranslator(locales, initialLocale = 'en') {
  let currentLocale = locales[initialLocale] ? initialLocale : 'en';

  const resolveDict = (locale) => locales[locale] || locales.en;

  function t(key, params) {
    const localized = lookup(resolveDict(currentLocale), key);
    if (localized !== undefined && typeof localized !== 'object') {
      return interpolate(localized, params);
    }
    const fallback = lookup(locales.en, key);
    if (fallback !== undefined && typeof fallback !== 'object') {
      return interpolate(fallback, params);
    }
    return key;
  }

  /** Array-valued keys (theory.faq, agentic.turnActions) resolve against the
   *  active locale when complete, otherwise against English. */
  function tArray(key) {
    const localized = lookup(resolveDict(currentLocale), key);
    if (Array.isArray(localized)) return localized;
    const fallback = lookup(locales.en, key);
    return Array.isArray(fallback) ? fallback : [];
  }

  function setLocale(locale) {
    if (locales[locale]) currentLocale = locale;
  }

  const getLocale = () => currentLocale;
  const getDirection = () => resolveDirection(currentLocale);

  return { t, tArray, setLocale, getLocale, getDirection };
}
