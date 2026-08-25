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

// ?sim= time-scale multiplier: 'instant' or a positive finite number.
// Zero/negative/garbage values fall back to 1x instead of pinning the sim
// clock at/below 0 so the simulation never completes (#1040). Shared by /
// (App) and /embed (EmbedApp) so both entry points agree on one URL.
export function readSimMultiplier() {
  const v = readParam('sim');
  if (v === 'instant') return 'instant';
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
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
  // Preserve any location hash (#919): the app must never strip the
  // #s/<slug> permalink fragment or ?tab=theory#<anchor> deep links that the
  // author's URL carried — replaceState with a hash-less URL erased them on
  // the very first render cycle.
  window.history.replaceState(null, '', url + (window.location.hash || ''));
}

// Build a shareable "try it" URL for a demo: sets the given params and marks
// autoplay so the target tab starts its simulation on load.
export function demoUrl(params) {
  const p = new URLSearchParams(params);
  p.set('autoplay', '1');
  return `${window.location.pathname}?${p.toString()}`;
}
