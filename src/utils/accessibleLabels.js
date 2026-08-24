// Accessible-name helpers for icon-only / context-free controls (#461 #464)
// and live-status message selection for async tables (#463 #465).
//
// Pure string builders so node --test can pin the exact accessible names
// agents read out of the accessibility tree; components only supply i18n
// text and row data.

/** Human label for a shortlist/benchmark row's rig (moved from
 *  HardwareShortlist so link labels and visible titles share one source). */
export function rigLabel(row = {}) {
  const hwClass = (row.hwClass || '').toLowerCase();
  if (hwClass === 'unified' && row.chip) {
    return `${row.chip}${row.unifiedMemoryGb ? ` ${row.unifiedMemoryGb}GB` : ''}`;
  }
  if (row.gpu) {
    const count = row.gpuCount || 1;
    return `${count > 1 ? `${count}× ` : ''}${row.gpu}${row.vramGb ? ` ${row.vramGb}GB` : ''}`;
  }
  return row.cpu || row.hardware || 'Unknown system';
}

/**
 * Accessible name for a per-row "View source run" link (#464): the visible
 * text alone is identical across ~40 rows, so the accessible name carries
 * the row context (rig · model family · quantization).
 */
export function sourceRunLinkLabel(row = {}, linkText = 'View source run') {
  const parts = [rigLabel(row)];
  if (row.modelFamily) parts.push(row.modelFamily);
  if (row.quantization) parts.push(row.quantization);
  return `${linkText}: ${parts.join(' · ')}`;
}

/**
 * Accessible name for the Theory FAQ demo buttons (#461): pairs the action
 * text with the question the button demos so icon-only renders still name
 * their target.
 */
export function demoButtonLabel(question, actionText) {
  return `${actionText}: ${question}`;
}

/**
 * Message for a persistent polite live region tracking an async table's
 * lifecycle (#465). The region must stay mounted so SR users hear
 * loading → loaded transitions; each state's message is composed by the
 * caller from existing i18n strings.
 */
export function tableLiveStatus(status, messages = {}) {
  return messages[status] ?? '';
}
