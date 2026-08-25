// Issue #876: unknown string ids in deep links (?preset=, ?gpu=, ?wp=) used
// to be silently swapped for a default AND erased from the URL by the first
// writeParams() pass — a mistyped share link mutated into a plausible-looking
// but wrong config with zero signal. These helpers let each view keep the
// original value in the state/URL (speeds fall back to defaults internally)
// while surfacing an explicit invalid-param signal instead:
//   - a visible warning notice (rendered by the caller),
//   - a machine-readable `data-invalid-param="name=value"` attribute,
//   - a console.warn on first paint.

/**
 * From a list of `{ name, value, isValid }` readings, return the entries
 * whose value is present but not valid. Absent params (null/'') are never
 * invalid — they simply get their default. `isValid` may be a boolean or a
 * `(value) => boolean` predicate.
 */
export function findInvalidIdParams(entries) {
  return entries
    .filter(e => {
      if (e.value == null || e.value === '') return false;
      return typeof e.isValid === 'function' ? !e.isValid(e.value) : !e.isValid;
    })
    .map(e => ({ name: e.name, value: e.value }));
}

/** Machine-readable attribute value, e.g. `preset=nvidia_h100,gpu=bogus`. */
export function invalidParamAttr(invalid) {
  return invalid.map(i => `${i.name}=${i.value}`).join(',');
}

/** Human-readable label list for the visible notice. */
export function invalidParamLabel(invalid) {
  return invalid.map(i => `${i.name}="${i.value}"`).join(', ');
}

/** One-shot console signal; safe to call unconditionally on mount. */
export function warnInvalidParams(invalid, log = console.warn.bind(console)) {
  if (!invalid || invalid.length === 0) return;
  log(
    `[share-link] unknown id param(s): ${invalidParamLabel(invalid)} — kept in`
    + ' the URL but not applied; the app fell back to defaults. Valid id'
    + ' values are documented in /llms.txt (deep links) and served by'
    + ' /api/presets.'
  );
}
