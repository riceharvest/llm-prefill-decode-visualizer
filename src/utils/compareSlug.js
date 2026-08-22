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
 */
export function parseComparePath(pathname) {
  const m = /^\/compare\/([^/]+?)-vs-([^/]+?)\/?$/.exec(String(pathname || ''));
  if (!m || !m[1] || !m[2]) return null;
  return { a: decodeURIComponent(m[1]), b: decodeURIComponent(m[2]) };
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
