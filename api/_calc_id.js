// Deterministic computation IDs (issue #68).
// An ID is a pure function of the request: calc_ + first 12 hex chars of
// sha256 over the canonical JSON of {endpoint, normalized params}. No storage:
// anyone holding the same params re-derives the same id, and /api/calc/<id>
// verifies a replay against it.

import { createHash } from 'node:crypto';

const PURE_NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Canonicalize raw request params so semantically identical requests hash equal:
 * - keys sorted
 * - numeric strings and numbers collapse ("4096" === 4096)
 * - booleans stay booleans, everything else becomes a string
 * - undefined / null / empty-string values are dropped (they mean "default")
 */
export function normalizeParams(params) {
  const out = {};
  for (const key of Object.keys(params || {}).sort()) {
    const v = params[key];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'number') {
      out[key] = Object.is(v, -0) ? 0 : v;
    } else if (typeof v === 'boolean') {
      out[key] = v;
    } else if (typeof v === 'string' && PURE_NUMERIC.test(v.trim())) {
      const n = Number(v.trim());
      out[key] = Object.is(n, -0) ? 0 : n;
    } else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      // #1056: the compute handlers coerce values with Number(), so spellings
      // like "0x800", "+2048" or "1e3" execute identically to their decimal
      // value — they must hash identically too or /api/calc/<id> replay and
      // dedup-by-id break. Empty/whitespace-only strings stay strings
      // (Number('') === 0 would wrongly mint the default).
      const n = Number(v);
      out[key] = Object.is(n, -0) ? 0 : n;
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

/** Stable content hash: `calc_<12 hex chars>` for an endpoint + params pair. */
export function computeCalcId(endpoint, params) {
  const canonical = JSON.stringify({ endpoint: String(endpoint), params: normalizeParams(params) });
  return 'calc_' + createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function isValidCalcId(id) {
  return typeof id === 'string' && /^calc_[0-9a-f]{12}$/.test(id);
}
