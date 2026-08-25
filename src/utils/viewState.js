// Uniform awaitability contract for animated tabs (issue #701).
//
// A DOM-scraping agent that triggers a simulation needs ONE stable predicate
// for "the result is final". Before this module each tab exposed its run state
// differently (phase tag classes that collided mid-run vs final, bare prose
// spans, fixed classes), so no uniform selector existed.
//
// Every animated tab's simulation-stage section now carries:
//   data-state="idle" | "running" | "done"
//   aria-busy="true" only while a run is in flight
// driven by these pure helpers so the mapping stays testable and identical
// across tabs.

/**
 * Map a phase-machine value ('idle' | 'prefilling' | 'decoding' |
 * 'completed') onto the uniform awaitability states. Unknown phases count as
 * running (conservative: an agent waiting for "done" never fires early).
 */
export function phaseToRunState(phase) {
  if (phase === 'idle') return 'idle';
  if (phase === 'completed') return 'done';
  return 'running';
}

/**
 * Map a playback clock onto the same vocabulary for tabs without an explicit
 * phase machine (A/B replay, batching): elapsed <= 0 → idle, elapsed >= total
 * (finite positive total) → done, otherwise running.
 */
export function clockToRunState(elapsed, total) {
  if (!(elapsed > 0)) return 'idle';
  if (Number.isFinite(total) && total > 0 && elapsed >= total) return 'done';
  return 'running';
}

/** aria-busy is true only while a run is in flight. */
export function runStateToBusy(state) {
  return state === 'running';
}
