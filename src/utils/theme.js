// Theme selection (issue #81): dark is the site default, with light and a pure
// black/white high-contrast palette. index.css keys every color token off
// <html data-theme="…"> ([data-theme='light'] / [data-theme='high-contrast']
// override blocks; dark needs no attribute because :root already carries it).
//
// Initial resolution order:
//   1. ?theme=light|dark|high-contrast URL param (validated against THEMES)
//   2. explicit user choice persisted in localStorage under `llmpd-theme`
//   3. prefers-contrast: more → high-contrast
//   4. OS color-scheme preference (light → light, otherwise dark)
// While neither the URL nor an explicit stored pick is present, OS preference
// changes are followed live; once one of them applies, it wins until cleared.
//
// Machine-readable state for agents (issues #662 #668):
//   - `<html data-theme>` always carries the active palette name
//   - `?theme=` deep-links a rendering mode without touching storage
//   - localStorage key `llmpd-theme` holds an explicit user pick
//   - window event `llmpd-theme-change` fires on programmatic switches

const STORAGE_KEY = 'llmpd-theme';
export const THEME_CHANGE_EVENT = 'llmpd-theme-change';
export const THEME_URL_PARAM = 'theme';
export const THEMES = ['dark', 'light', 'high-contrast'];

const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';
const CONTRAST_QUERY = '(prefers-contrast: more)';

function storageGet() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage unavailable (private mode / SSR)
  }
}

function storageSet(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore — theme just won't persist across reloads
  }
}

export function isValidTheme(theme) {
  return THEMES.includes(theme);
}

/** Persisted user choice, or null when running on OS defaults. */
export function getStoredTheme() {
  const stored = storageGet();
  return isValidTheme(stored) ? stored : null;
}

function mediaMatches(query) {
  try {
    return typeof matchMedia === 'function' && matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Theme requested via the ?theme= URL param, or null when absent/invalid. */
export function getUrlTheme() {
  try {
    if (typeof window === 'undefined' || !window.location) return null;
    const value = new URLSearchParams(window.location.search).get(THEME_URL_PARAM);
    return isValidTheme(value) ? value : null;
  } catch {
    return null; // no location (tests/SSR) — fall through to other signals
  }
}

export function resolveInitialTheme() {
  // ?theme= wins so deep links always render the requested mode (#668),
  // even over a previously stored explicit choice.
  const fromUrl = getUrlTheme();
  if (fromUrl) return fromUrl;
  const stored = getStoredTheme();
  if (stored) return stored;
  if (mediaMatches(CONTRAST_QUERY)) return 'high-contrast';
  if (mediaMatches(LIGHT_SCHEME_QUERY)) return 'light';
  return 'dark';
}

/** Apply a theme to the document without persisting it. */
export function applyTheme(theme) {
  if (!isValidTheme(theme)) return;
  try {
    document.documentElement.dataset.theme = theme;
  } catch {
    // ignore — no document (tests/SSR)
  }
}

/** Persist the user's choice, apply it, and announce the change. */
export function setTheme(theme) {
  if (!isValidTheme(theme)) return;
  storageSet(theme);
  applyTheme(theme);
  try {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
  } catch {
    // ignore — no window (tests/SSR)
  }
}

/** Currently applied theme, falling back to what would be resolved. */
export function getTheme() {
  const applied = typeof document !== 'undefined'
    ? document.documentElement.dataset.theme
    : undefined;
  return isValidTheme(applied) ? applied : resolveInitialTheme();
}

// Apply before first paint — main.jsx imports this module ahead of rendering.
applyTheme(resolveInitialTheme());

// Follow live OS changes only while the user hasn't made an explicit pick.
try {
  if (typeof matchMedia === 'function') {
    const followOs = () => {
      // Live-follow only while nothing more specific (URL param or stored
      // pick) is in charge — otherwise it would clobber an explicit request.
      if (!getUrlTheme() && !getStoredTheme()) applyTheme(resolveInitialTheme());
    };
    matchMedia(LIGHT_SCHEME_QUERY).addEventListener('change', followOs);
    matchMedia(CONTRAST_QUERY).addEventListener('change', followOs);
  }
} catch {
  // ignore — very old browsers without matchMedia listeners keep the resolved default
}
