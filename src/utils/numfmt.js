// Locale-independent number formatting for agent-facing surfaces (issue #635).
//
// Every server-side handler pins 'en-US' number formatting, but client-side
// formatters called bare `toLocaleString()`, so exports, clipboard payloads,
// and aria-text rendered in a de-DE/fr-FR/ar-EG browser came out host-locale
// formatted ("12.345", "12 345", Arabic-Indic digits) — silently misparsed or
// rejected by agents, and byte-different from the API for identical inputs.
//
// fmtEn() pins en-US grouping so any surface an agent reads (downloads,
// clipboard, aria-valuetext, i18n-interpolated strings) matches the API.
// Non-finite inputs pass through untouched (∞ sentinels stay symbolic).

const EN_US = typeof Intl !== 'undefined' && Intl.NumberFormat
  ? new Intl.NumberFormat('en-US')
  : null;

export function fmtEn(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (EN_US) return EN_US.format(n);
  // Manual fallback mirroring en-US grouping if Intl is unavailable.
  const int = Math.round(n);
  return String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
