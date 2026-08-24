// Accessible text summaries for chart widgets whose data is otherwise
// visual-only (#922, #923).
//
// - buildKvMatrixSummary: the full text contract for the KV-cache matrix,
//   which renders as role="img" (children are pruned from the a11y tree).
//   The append variant flips whole rows discretely, so the summary reports
//   the written-row COUNT that matches the pixels instead of a fill
//   percentage that rounds differently; it also names the still-appending
//   newest row and the prefix-cache-hit share of what has been written.
// - needsStackedBarLegend: the single-turn walltime stacked bar suppresses
//   in-segment labels below STACKED_BAR_LABEL_THRESHOLD % width, and its
//   tooltip is hover-only — so whenever either phase falls under the
//   threshold, an always-visible legend line must carry both phases'
//   percentage and absolute time for sighted keyboard/touch users.

export const STACKED_BAR_LABEL_THRESHOLD = 8;

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

export function buildKvMatrixSummary({
  title,
  variant = 'parallel',
  fillFrac = 0,
  appendedRows = 0,
  totalRows = 0,
  cachedFracOfFill = 0
}) {
  const safeFillFrac = clamp01(fillFrac);
  const fillPct = Math.round(safeFillFrac * 100);
  const rows = Math.max(0, totalRows || 0);
  const parts = [];

  if (variant === 'append' && rows > 0) {
    const written = Math.min(rows, Math.max(0, appendedRows || 0));
    parts.push(`${written} of ${rows} cache rows written`);
    if (written > 0 && written < rows && safeFillFrac > 0 && safeFillFrac < 1) {
      parts.push('newest row still appending');
    }
  } else {
    parts.push(`${fillPct}% of ${rows} cache rows filled`);
  }

  const cachedPct = Math.round(clamp01(cachedFracOfFill) * 100);
  if (cachedPct > 0) {
    parts.push(`${cachedPct}% of written tokens are prefix-cache hits`);
  }

  return `${title}: ${parts.join('; ')}`;
}

export function needsStackedBarLegend(prefillPct, decodePct, threshold = STACKED_BAR_LABEL_THRESHOLD) {
  return prefillPct <= threshold || decodePct <= threshold;
}
