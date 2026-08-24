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

// Like readParamNum but additionally rejects zero/negative values — for
// params where 0 or a negative number is meaningless or harmful (e.g. the
// ?sim= speed multiplier: EmbedApp used to keep 0 and freeze at PHASE 1
// forever while App upgraded it to 1x; negative values pinned the sim clock
// below zero so runs never completed). Falls back instead (#1040).
export function readParamPosNum(name, fallback) {
  const n = readParamNum(name, NaN);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readParamBool(name, fallback) {
  const v = readParam(name);
  if (v === null || v === '') return fallback;
  return v === '1' || v === 'true';
}

// Consume the ?autoplay=1 demo-link flag exactly ONCE per page load.
// Every simulator used to re-read the raw param at mount, so ?autoplay=1
// re-fired its start timer every time you navigated away from a tab and
// back (#818), while tab=ab ignored the flag entirely (#693). Callers
// auto-start only when this returns true; later mounts get false.
let autoplayConsumed = false;
export function consumeAutoplay() {
  if (autoplayConsumed) return false;
  if (readParamBool('autoplay', false)) {
    autoplayConsumed = true;
    return true;
  }
  return false;
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
