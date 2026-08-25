// Selector/ARIA contract for collapsible panels (#799).
//
// Agents pin sections by the canonical id (#snapshots, #slo-budgets, …), so
// the <section> must carry a real id= attribute — not just the undocumented
// data-collapsible hook. The toggle button may only reference the body via
// aria-controls while that body is actually mounted (open); a dangling
// aria-controls pointing at an unmounted id fails AT validation.

/** Attributes for the collapsible <section> element: the canonical id anchor
 *  plus the legacy data-collapsible hook, kept for backwards compatibility. */
export function sectionAttributes(id) {
  return { id, 'data-collapsible': id };
}

/** ARIA attributes for the toggle button. aria-controls is emitted only while
 *  the body it names is rendered (open). */
export function toggleAriaAttributes(id, open) {
  const attrs = { 'aria-expanded': open };
  if (open) attrs['aria-controls'] = `${id}-body`;
  return attrs;
}
