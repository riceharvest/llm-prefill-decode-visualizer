// Fetch-state DOM signals (#732): the fetch-driven views (FindHW shortlist,
// Compare, Diff, LocalMaxxing pickers) previously showed loading only as
// ephemeral English prose that vanished on completion — indistinguishable
// from an empty result set for scrapers and screen readers. These helpers
// render each view's state machine into stable DOM attributes instead.

/**
 * Attributes encoding a fetch lifecycle state on a results container.
 * `status` is one of 'loading' | 'ready' | 'error'; anything else is passed
 * through so views can expose richer vocabularies ('idle' | 'done', …).
 */
export function fetchStateAttrs(status) {
  return {
    'data-state': status,
    'aria-busy': status === 'loading'
  };
}

/** Diff-view state from its (loading, error, result) React triple. */
export function runDiffViewState({ loading = false, error = null, result = null } = {}) {
  if (error) return 'error';
  if (loading) return 'loading';
  if (result) return 'done';
  return 'idle';
}
