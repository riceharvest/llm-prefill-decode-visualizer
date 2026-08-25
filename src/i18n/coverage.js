// Locale translation-coverage signal (#797).
//
// ?lang=ar renders ~91% English text under html lang="ar" because partial
// locales silently fall back per-key. Nothing told an agent (or human) how
// complete a locale actually was. These helpers compute leaf-key coverage
// against English so the number can live in each locale's _meta.json and be
// surfaced at runtime instead of being an undocumented accident.

/** Leaf paths of a nested translations dict, dotted ('header.brandTitle').
 *  Arrays count as one leaf. The reserved 'meta' namespace is skipped. */
export function flattenKeys(dict, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(dict || {})) {
    if (prefix === '' && key === 'meta') continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...flattenKeys(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * Coverage of `target` relative to English `source`.
 * Returns { total, translated, missing, fraction } where fraction ∈ [0,1]
 * counts leaf keys present (any value, including empty strings) in target.
 */
export function localeCoverage(source, target) {
  const keys = flattenKeys(source);
  const present = new Set(flattenKeys(target));
  const translated = keys.filter(k => present.has(k)).length;
  const total = keys.length;
  return {
    total,
    translated,
    missing: total - translated,
    fraction: total === 0 ? 1 : translated / total
  };
}
