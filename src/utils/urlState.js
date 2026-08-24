// Lightweight URL query-param helpers for shareable per-tab settings.
// Settings are written with history.replaceState so the URL always reflects
// the current state without spamming browser history.

export function readParam(name) {
  const p = new URLSearchParams(window.location.search);
  return p.get(name);
}

/** All occurrences of a param, in query order (#950). */
export function paramValues(searchParams, name) {
  return new URLSearchParams(searchParams).getAll(name);
}

/**
 * Duplicate-key precedence for validated params (#950): the FIRST VALID
 * occurrence wins. Validation runs BEFORE dedup, so a leading junk value no
 * longer discards a valid duplicate — ?tab=bogus&tab=diff lands on 'diff'
 * instead of silently falling back to the default. When every occurrence is
 * invalid (or the param is absent) this returns null; callers apply their
 * fallback. Note URLSearchParams.get() alone returns only the first
 * occurrence, which is why the naive first-wins read broke here.
 */
export function firstValidParam(searchParams, name, isValid) {
  for (const v of paramValues(searchParams, name)) {
    if (isValid(v)) return v;
  }
  return null;
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
}

// Build a shareable "try it" URL for a demo: sets the given params and marks
// autoplay so the target tab starts its simulation on load.
export function demoUrl(params) {
  const p = new URLSearchParams(params);
  p.set('autoplay', '1');
  return `${window.location.pathname}?${p.toString()}`;
}
