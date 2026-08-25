// Real-world analogy mode (issue #84): an optional toggle that surfaces an
// everyday analogy inline next to technical terms — 'prefill = reading the
// whole book before answering', 'decode = speaking one word at a time',
// 'prefix caching = remembering what you already read'.
//
// The on/off preference is persisted in localStorage and broadcast via a
// window event so every mounted <Analogy /> chip reacts to the toggle
// without prop-drilling through App → Header → tabs.

const STORAGE_KEY = 'llmpd-analogy-mode';
export const ANALOGY_CHANGE_EVENT = 'llmpd-analogy-change';

/** term → everyday analogy text (i18n key lives in strings.js analogies.items). */
export const ANALOGY_TERMS = ['prefill', 'decode', 'prefixCaching', 'kvCache'];

export function getAnalogyMode() {
  // URL override first (#638): ?analogy=1 / ?analogy=true forces the variant
  // on, ?analogy=0 / ?analogy=false forces it off — link-addressable for
  // agents and share links, no localStorage or script injection required.
  try {
    const v = new URLSearchParams(window.location.search).get('analogy');
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  } catch {
    // no window (tests/SSR) — fall through to storage
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false; // storage unavailable (private mode / SSR) — default off
  }
}

export function setAnalogyMode(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // ignore — mode just won't persist across reloads
  }
  try {
    window.dispatchEvent(new CustomEvent(ANALOGY_CHANGE_EVENT, { detail: { on } }));
  } catch {
    // ignore — no window (tests/SSR); mounted chips pick the state up on mount
  }
}
