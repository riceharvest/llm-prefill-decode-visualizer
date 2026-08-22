// Engine-version cohorting helpers (issue #29):
// tag runs with engine name + version/build so comparisons default to
// same-engine cohorts, and mixed-version groups get flagged with a warning.

/**
 * "llama.cpp b4523" style label for a run; falls back to the bare engine
 * name (or 'unknown') when upstream has no engineVersion recorded.
 */
export function engineTag(run) {
  const name = run.engine || 'unknown';
  const version = run.engineVersion;
  return version ? `${name} ${version}` : name;
}

/** Distinct engine tags present in a set of runs, in first-seen order. */
export function engineTags(runs) {
  return [...new Set(runs.map(engineTag))];
}

/** True when the runs do not all share the same engine name+version. */
export function mixesEngineVersions(runs) {
  return engineTags(runs).length > 1;
}

/**
 * Case-insensitive substring match against the "name version" tag, so
 * ?engine=llama.cpp matches every llama.cpp build while ?engine=b4000
 * narrows to one build.
 */
export function matchesEngineQuery(run, query) {
  if (!query) return true;
  return engineTag(run).toLowerCase().includes(String(query).toLowerCase());
}

/**
 * Human-readable caution message for a group that mixes engine versions,
 * or null when the group is a single-engine cohort.
 */
export function mixedEngineWarning(key, runs) {
  const tags = engineTags(runs);
  if (tags.length <= 1) return null;
  return `${key} mixes engine versions (${tags.join(', ')}) — treat delta with caution`;
}
