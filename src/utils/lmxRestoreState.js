// Machine-readable restore state for `?preset=lmx:<runId>` deep links (#596).
//
// A bare `preset=lmx:<id>` in the URL is NOT a self-contained config: the
// measured speeds only load after the LocalMaxxing picker's client-side
// fetch succeeds AND finds the run id. Until then (or on failure) the app
// silently runs default RTX 4090 EXL2 speeds under an lmx: preset label.
// These helpers classify that state so it can be exposed as a data attribute
// (`data-lmx-status` on .app-shell) that agents can read instead of having
// to diff numbers.

/**
 * @param {object} s
 * @param {string|null} s.presetId  active preset id ('' if none)
 * @param {boolean} s.fetchFailed   picker index/model fetch errored
 * @param {boolean} s.runsLoaded    candidate run list is non-empty
 * @param {boolean} s.runFound      initialRunId resolved to a run
 * @returns {'inactive'|'pending'|'error'|'not_found'|'applied'}
 */
export function resolveLmxRestoreStatus({ presetId, fetchFailed, runsLoaded, runFound }) {
  if (!presetId || !presetId.startsWith('lmx:')) return 'inactive';
  if (fetchFailed) return 'error';
  if (runFound) return 'applied';
  if (!runsLoaded) return 'pending';
  return 'not_found';
}

/** Attribute value for document.querySelector('.app-shell').dataset.lmxStatus. */
export function applyLmxStatusAttr(el, status) {
  if (!el) return false;
  el.setAttribute('data-lmx-status', status);
  return true;
}

/** Short human-readable hint for the not_found/error states. */
export function lmxStatusHint(status, runId) {
  switch (status) {
    case 'not_found':
      return `Share-link preset lmx:${runId} was not found in the LocalMaxxing dataset — the simulation is running default preset speeds.`;
    case 'error':
      return 'The LocalMaxxing dataset could not be loaded, so a share-linked measured preset could not be applied — the simulation is running default preset speeds.';
    default:
      return null;
  }
}
