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

// Issue #450: resolve a `?tab=` value against the valid view enum so an
// unknown deep link is DETECTABLE instead of silently falling back.
// Returns { tab, matched }: `tab` is always safe to render; `matched` is
// false only when the caller explicitly passed a value that is not in the
// enum (absent/empty param counts as matched so plain loads never warn).
export function resolveTabParam(value, validTabs, fallback = 'single') {
  if (value === null || value === '') return { tab: fallback, matched: true };
  if (validTabs.includes(value)) return { tab: value, matched: true };
  return { tab: fallback, matched: false };
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
}

// Build a shareable "try it" URL for a demo: sets the given params and marks
// autoplay so the target tab starts its simulation on load.
export function demoUrl(params) {
  const p = new URLSearchParams(params);
  p.set('autoplay', '1');
  return `${window.location.pathname}?${p.toString()}`;
}
