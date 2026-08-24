// Accessible-control helpers for the batching timeline request rows (#982).
//
// Selecting a request — the only way to populate the per-request ITL chart —
// was a bare onClick on a plain <div>: no role, no tabindex, no keyboard
// handler, so keyboard/AT users could never reach any request but the first.

/**
 * A11y attribute spread for one interactive request row.
 *
 * @param {{id: number|string}} req
 * @param {boolean} isSelected
 */
export function requestRowA11y(req, isSelected) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-pressed': isSelected === true,
    'aria-label': `Request R${req.id} — select to show its inter-token latency chart${isSelected ? ' (selected)' : ''}`
  };
}

/** True when a keyboard event activates a button-like row (Enter or Space). */
export function isRowActivateKey(event) {
  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}
