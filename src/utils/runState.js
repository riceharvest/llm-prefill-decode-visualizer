// Machine-readable run-state contract (issue #827).
//
// Every simulator stage exposes its internal phase state machine to the DOM
// as `data-run-state` + `aria-busy`, so scrapers and agents can detect
// "result is final" without diffing successive snapshots or natural-language-
// matching localized prose. States:
//   idle | prefilling | decoding | completed   (single-turn, agentic loop)
//   idle | running | completed                 (batching schedule)

/** Attributes to spread on a view's stage <section> for a given run state. */
export function runStateAttrs(state) {
  const running = state === 'prefilling' || state === 'decoding' || state === 'running';
  return {
    'data-run-state': state,
    ...(running ? { 'aria-busy': 'true' } : {})
  };
}

/**
 * Status-tag class per phase. `completed` gets its own class instead of
 * reusing `tag-decode` — the one CSS hook scrapers had could not separate
 * running from done (#827).
 */
export function phaseTagClass(phase) {
  if (phase === 'prefilling') return 'tag-prefill';
  if (phase === 'decoding') return 'tag-decode';
  if (phase === 'completed') return 'tag-complete';
  return '';
}
