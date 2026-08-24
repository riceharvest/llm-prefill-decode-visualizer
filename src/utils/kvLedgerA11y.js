// Accessible-name helpers for the KV-cache memory-ledger visuals (#777 #788).
//
// The ledger math (api/_math.js memoryLedger) keeps utilizationPct at 6-decimal
// precision, which used to leak verbatim into aria-labels and table cells
// ("672.678894% of 24 GB"). These helpers give every ledger surface one
// rounded, consistent spelling without touching the API contract.

/**
 * Round a utilization percentage to 1 decimal for display / assistive-tech
 * surfaces. Non-finite / missing input falls back to the em-dash placeholder
 * already used by the ledger rows.
 */
export function formatUtilizationPct(pct) {
  if (pct === null || pct === undefined || pct === '') return '—'; // Number(null)/Number('') are 0
  const n = Number(pct);
  if (!Number.isFinite(n)) return '—';
  return String(Math.round(n * 10) / 10);
}

/**
 * Compose an accessible name for the planner's stacked ledger bar out of the
 * same legend strings rendered beneath it (#777: segment identity previously
 * lived only in hover-only title attributes, invisible to AT and scrapers).
 *
 * @param {{label?: string, value?: string}[]} segments ordered visual segments
 * @param {string} [limitLabel] trailing GPU-limit marker label
 * @returns {string} single-line accessible name
 */
export function stackedLedgerBarAria(segments, limitLabel) {
  const body = (Array.isArray(segments) ? segments : [])
    .filter(s => s && s.label)
    .map(s => `${s.label}${s.value ? ` ${s.value}` : ''}`)
    .join(', ');
  return limitLabel ? `${body} — ${limitLabel}` : body;
}
