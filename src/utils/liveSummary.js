/**
 * Bucketed progress narration helpers (issue #1041).
 *
 * aria-live regions re-announce whenever their text changes, so run-summary
 * strings must stay stable between milestones. Embedding raw per-request
 * counters (finished-so-far, currently-running) makes the text change on
 * every request start/finish and defeats time-bucketed announcements.
 *
 * These helpers derive all announced quantities from the same coarse time
 * bucket so the summary changes at most once per bucket.
 */

/** Which of `buckets` equal slices of `total` does `elapsed` fall into? */
export function progressBucket(elapsed, total, buckets = 4) {
  const b = Number.isFinite(buckets) && buckets >= 1 ? Math.floor(buckets) : 4;
  if (!(total > 0) || !(elapsed >= 0)) return { index: 0, start: 0 };
  const index = Math.min(b - 1, Math.max(0, Math.floor((elapsed / total) * b)));
  return { index, start: (index / b) * total };
}

/** How many requests had finished by simulation time `t`? */
export function finishedCountAt(requests, t) {
  let n = 0;
  for (const r of requests || []) {
    if (r && r.finishTime !== null && r.finishTime !== undefined && r.finishTime <= t) n += 1;
  }
  return n;
}
