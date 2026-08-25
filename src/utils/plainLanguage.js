// Plain-language mode (issue #79): an optional toggle that swaps dense
// technical terms for plain equivalents — 'TTFT' → 'wait before the first
// word appears', 'GEMV' → 'memory-speed math step' — while the technical
// term stays reachable via tooltip or the expandable glossary in the Theory
// tab (progressive jargon disclosure).
//
// The on/off preference is persisted in localStorage and broadcast via a
// window event so every mounted <Jargon /> and the tPlain()/plainify()
// helpers react to the header toggle without prop-drilling.
//
// The term dictionary itself lives in the i18n layer (strings.js,
// plainLanguage.terms) so translations inherit the feature for free: a
// locale either overrides plainLanguage.terms with its own plain phrasings
// or falls back to the English ones.

const STORAGE_KEY = 'llmpd-plain-mode';
export const PLAIN_CHANGE_EVENT = 'llmpd-plain-change';

/** Semantic keys of the jargon dictionary (strings.js plainLanguage.terms). */
export const PLAIN_TERMS = [
  'prefill',
  'decode',
  'ttft',
  'tpot',
  'gemm',
  'gemv',
  'kvCache',
  'prefixCaching',
  'vram',
  'token',
  'computeBound',
  'bandwidthBound'
];

/**
 * Stable DOM id for one glossary entry (#583): `#glossary-prefill` style
 * anchors so individual definitions are deep-linkable and citable. Slugs are
 * lowercase, non-alphanumerics collapsed to '-' (kvCache → glossary-kvcache).
 */
export function glossaryTermId(term) {
  return 'glossary-' + String(term || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getPlainMode() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false; // storage unavailable (private mode / SSR) — default off
  }
}

export function setPlainMode(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // ignore — mode just won't persist across reloads
  }
  try {
    window.dispatchEvent(new CustomEvent(PLAIN_CHANGE_EVENT, { detail: { on } }));
  } catch {
    // ignore — no window (tests/SSR); consumers pick the state up on mount
  }
}
