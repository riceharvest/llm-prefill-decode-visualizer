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

// Shared boolean table — must stay identical to parseBoolParam in
// api/_handlers/compute.js (#765) so a share-link value and the equivalent
// API query param always resolve to the same polarity.
const TRUTHY_BOOLEANS = new Set(['1', 'true', 'yes', 'on']);
const FALSY_BOOLEANS = new Set(['0', 'false', 'no', 'off']);

export function readParamBool(name, fallback) {
  const v = readParam(name);
  if (v === null || v === '') return fallback;
  const s = v.toLowerCase();
  if (TRUTHY_BOOLEANS.has(s)) return true;
  if (FALSY_BOOLEANS.has(s)) return false;
  return fallback;
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
