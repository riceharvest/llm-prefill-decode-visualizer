// Snapshot list metadata helpers (issue #629).
//
// Snapshot rows used to be indistinguishable in the DOM: createdAt was stored
// but never rendered, unnamed snapshots all read "Untitled snapshot", and no
// row carried its id — so agents/AT could only address entries positionally
// against a live-mutating list. These helpers back the additive fix: unique
// default names, an ISO timestamp for <time datetime>/data-created-at, and a
// data-snapshot-id attribute per <li>.

/**
 * Return `base`, or `base 2` / `base 3` … when existing names already use it,
 * so N unnamed snapshots never collide under the same accessible name.
 */
export function uniqueSnapshotName(existingNames, base = 'Untitled snapshot') {
  const taken = new Set(existingNames.map(n => String(n)));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Machine-readable timestamp attributes for a stored epoch-ms createdAt.
 * Returns null for absent/invalid values so legacy snapshots render cleanly.
 */
export function snapshotTimestampAttrs(createdAt) {
  const t = Number(createdAt);
  if (!Number.isFinite(t) || t <= 0) return null;
  const iso = new Date(t).toISOString();
  return { iso };
}
