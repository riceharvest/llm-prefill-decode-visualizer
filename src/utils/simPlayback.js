/**
 * Shared decision for the skip-animation escape hatches (#1079).
 *
 * `?sim=instant` (#892) and `prefers-reduced-motion` (#63/#844) both mean
 * "skip the streaming animation, land on the final state". Both hatches used
 * to be gated INSIDE each view's requestAnimationFrame tick callback, so they
 * silently never fired in hidden/background tabs where rAF is not serviced at
 * all (#457 environment) — and even one throttled frame per second stretched
 * the "instant" path into seconds. Views must evaluate this BEFORE arming
 * rAF and complete synchronously when it returns true.
 */
export function shouldCompleteInstantly(simSpeedMultiplier, prefersReducedMotion) {
  return simSpeedMultiplier === 'instant' || prefersReducedMotion === true;
}
