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

// Token counts are discrete (#386): a fractional ?prompt=2048.7 used to leak
// into state where some panels rounded and others displayed the raw fraction,
// so the same render disagreed with itself ("2,048.7 tok" vs "0 / 2,049 tok").
// One policy at parse time: positive integers only, anything else falls back.
export function readTokenCount(name, fallback) {
  const v = readParam(name);
  if (v === null || v === '') return fallback;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
  window.history.replaceState(null, '', url);
}

// Build a shareable "try it" URL for a demo: sets the given params and marks
// autoplay so the target tab starts its simulation on load.
// Starts from the LIVE query string (#644): previously every demo link dropped
// all active params — ?lang=ar reverted to English and any other current-URL
// state was silently reset. Demo params overlay on top and win on conflicts;
// autoplay=1 is always set by the demo itself.
export function demoUrl(params) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of new URLSearchParams(params)) p.set(k, v);
  p.set('autoplay', '1');
  const qs = p.toString();
  return qs
    ? `${window.location.pathname}?${qs}`
    : window.location.pathname;
}
