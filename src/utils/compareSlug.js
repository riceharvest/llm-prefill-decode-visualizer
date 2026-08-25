// Slug helpers for the SEO comparison pages (/compare/:a-vs-:b).
//
// Hardware labels from /api/benchmarks ("RTX 3090", "M3 Max 16-Core GPU")
// are turned into URL slugs ("rtx-3090", "m3-max-16-core-gpu") both when
// building links and when matching a :a-vs-:b path segment back to a group.

/** Lowercase, strip non-alphanumerics, collapse whitespace to single dashes. */
export function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse "/compare/:a-vs-:b" into { a, b } slugs.
 * Returns null for anything that isn't a well-formed /compare/ path.
 * Malformed %-encoding in a segment is kept verbatim instead of throwing,
 * so a garbage URL still reaches the not-found path rather than crashing.
 */
export function parseComparePath(pathname) {
  const m = /^\/compare\/([^/]+?)-vs-([^/]+?)\/?$/.exec(String(pathname || ''));
  if (!m || !m[1] || !m[2]) return null;
  let a = m[1];
  let b = m[2];
  try {
    a = decodeURIComponent(a);
    b = decodeURIComponent(b);
  } catch {
    // Keep raw segments; they simply won't match any known slug.
  }
  return { a, b };
}

/**
 * Issue #759: decide whether a parsed /compare pair refers to hardware that
 * actually exists. `slugs` is any Set-like of known slugs (from the build-time
 * manifest or the API's `slug` fields). Returns:
 *   'ok'      — both sides resolved; serve 200
 *   'unknown' — at least one side has no measured runs; callers must 404
 */
export function comparePairStatus(slugs, a, b) {
  if (!a || !b) return 'unknown';
  const known = slugs && typeof slugs.has === 'function' ? slugs : new Set(slugs || []);
  return known.has(a) && known.has(b) ? 'ok' : 'unknown';
}

/**
 * Best-effort display name from a slug ("rtx-3090" -> "Rtx 3090").
 * Only used before live data loads; real labels replace it once fetched.
 */
export function prettifySlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map(w => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
