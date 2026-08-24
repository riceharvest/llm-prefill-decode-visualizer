// Lightweight URL query-param helpers for shareable per-tab settings.
// Settings are written with history.replaceState so the URL always reflects
// the current state without spamming browser history.

export function readParam(name) {
  const p = new URLSearchParams(window.location.search);
  return p.get(name);
}

export function readParamNum(name, fallback) {
  const v = readParam(name);
  if (v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function readParamBool(name, fallback) {
  const v = readParam(name);
  if (v === null || v === '') return fallback;
  return v === '1' || v === 'true';
}

export function writeParams(updates) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === null || v === '') {
      p.delete(k);
    } else {
      p.set(k, String(v));
    }
  }
  const qs = p.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
  // history.replaceState fires no event, so subscribers (e.g. App's permalink
  // title, issue #727) have no way to notice params that changed outside their
  // own React state. Announce the rewrite.
  if (typeof window.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent(URL_PARAMS_EVENT));
  }
}

// Event dispatched after every writeParams() rewrite of the query string.
const URL_PARAMS_EVENT = 'llmpd:url-params';

/**
 * Subscribe to query-string rewrites made through writeParams().
 * Returns an unsubscribe function.
 */
export function subscribeUrlParams(listener) {
  window.addEventListener(URL_PARAMS_EVENT, listener);
  return () => window.removeEventListener(URL_PARAMS_EVENT, listener);
}

// Build a shareable "try it" URL for a demo: sets the given params and marks
// autoplay so the target tab starts its simulation on load.
export function demoUrl(params) {
  const p = new URLSearchParams(params);
  p.set('autoplay', '1');
  return `${window.location.pathname}?${p.toString()}`;
}
