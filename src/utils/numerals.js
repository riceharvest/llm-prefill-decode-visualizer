// Locale-invariant number formatting (#920).
//
// Every numeral this app renders — DOM text, aria-valuetext, exports,
// clipboard payloads — goes through one module-level Intl.NumberFormat
// pinned to 'en-US'. The instances are created once at module load and are
// never touched by setLocale()/`?lang=`, so:
//   - identical URLs render byte-identical numerals on every host
//     (no more "4,096" vs "4.096" vs "12 345" across an agent fleet);
//   - <html lang> can no longer contradict the digits it frames;
//   - `\d+` regex extraction over rendered text yields correct magnitudes.
//
// The API side keeps the same invariant (#652): no comma-grouped numerics
// inside JSON string fields.

const intFormat = new Intl.NumberFormat('en-US');

/** Format a number en-US ("70,000,000,000"), independent of host locale and
 *  of any runtime setLocale() call. Non-finite input passes through as ''. */
export function formatNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return intFormat.format(n);
}

/** Like formatNum but tolerates null/undefined by returning a fallback. */
export function formatNumOr(value, fallback = '—') {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return fallback;
  return intFormat.format(n);
}
