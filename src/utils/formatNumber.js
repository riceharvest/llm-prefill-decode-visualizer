// Issue #735: the markdown exporters promise byte-identical output for the
// same inputs, but bare `.toLocaleString()` formats numbers with the VIEWER's
// host locale ("4,096" vs "4.096" vs "٤٬٠٩٦"), so the determinism contract is
// false. Pin grouping/decimal style to en-US — the format all existing
// outputs and docs already use — without changing any current English output.

const EN_US = new Intl.NumberFormat('en-US');

/**
 * Locale-invariant number formatting for exported artifacts.
 * Mirrors default `toLocaleString()` semantics (up to 3 fraction digits,
 * thousands grouping) but always in en-US.
 *
 * @param {number} value
 * @param {string} [locale] test seam — pass a locale to see what the host
 *   locale used to do to exports.
 * @returns {string}
 */
export function formatNum(value, locale) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return locale
    ? new Intl.NumberFormat(locale).format(n)
    : EN_US.format(n);
}
