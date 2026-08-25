// Deterministic computation IDs (issue #68).
// An ID is a pure function of the request: calc_ + first 12 hex chars of
// sha256 over the canonical JSON of {endpoint, normalized params}. No storage:
// anyone holding the same params re-derives the same id, and /api/calc/<id>
// verifies a replay against it.

import { createHash } from 'node:crypto';

const PURE_NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Canonicalize one value. Scalars behave exactly as before (#68); arrays and
 * plain objects are canonicalized recursively (#964) so nested payloads —
 * notably `batch: [...]` — hash from their CONTENT instead of JavaScript's
 * lossy `String([{...}])` coercion ("[object Object],[object Object]"), which
 * made every same-length batch collide on one id.
 */
function normalizeValue(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return Object.is(v, -0) ? 0 : v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (PURE_NUMERIC.test(v.trim())) {
      const n = Number(v.trim());
      return Object.is(n, -0) ? 0 : n;
    }
    return String(v);
  }
  if (Array.isArray(v)) {
    // Keep positions stable: dropped members become null rather than
    // shifting the rest (index alignment matters for batches).
    return v.map(x => {
      const nx = normalizeValue(x);
      return nx === undefined ? null : nx;
    });
  }
  if (typeof v === 'object') return normalizeParams(v);
  return String(v);
}

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
    const nv = normalizeValue(params[key]);
    if (nv !== undefined) out[key] = nv;
  }
  return out;
}

/** Stable content hash: `calc_<12 hex chars>` for an endpoint + params pair. */
export function computeCalcId(endpoint, params) {
  const canonical = JSON.stringify({ endpoint: String(endpoint), params: normalizeParams(params) });
  return 'calc_' + createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

/**
 * Batch envelope id (#942). Hash over every item's NORMALIZED params instead
 * of the raw transport body: the previous raw-body hash String()-coerced the
 * items array to "[object Object]" per entry, so any two equal-length batches
 * collided on one calc_ id, and the GET-string vs POST-array spellings of the
 * same batch minted different ids. Per-item ids (computeCalcId) are unchanged.
 */
export function computeBatchId(items) {
  const normalized = items.map(item =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? normalizeParams(item)
      : { invalid: String(item) }
  );
  const canonical = JSON.stringify({ endpoint: 'compute', batch: true, params: normalized });
  return 'calc_' + createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function isValidCalcId(id) {
  return typeof id === 'string' && /^calc_[0-9a-f]{12}$/.test(id);
}
