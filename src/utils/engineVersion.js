// Engine-version cohorting (issue #29): tag each community run with
// engine name + version/build so comparisons default to same-engine
// cohorts and mixed-version compares carry a visible caution.
//
// Pure functions only — shared by the /api endpoints and the frontend.

const BUILD_PATTERNS = [
  // llama.cpp build tags: b10470, b9947-14-gef8291cc2, b9775 / be4a6a63e
  /\bb(\d{3,6})(?:-\d+-g[0-9a-f]+)?/i,
  // semver-ish versions: 0.20.2, v0.11.0, 0.20.1rc1.dev30
  /\bv?(\d+\.\d+(?:\.\d+)?(?:[+-][\w.]+)?(?:rc\d+)?(?:\.dev\d+)?)/i,
  // short commit shas mentioned as a build: "commit 6b4dc21"
  /\bcommit\s+([0-9a-f]{7,12})\b/i
];

/**
 * Resolve the engine build/version for a raw upstream run row.
 * Prefers the structured engineVersion field; falls back to parsing the
 * free-text notes and the benchmark command snippet (e.g. a
 * llama-bench.exe path containing the build number).
 * Returns a short tag string like "llama.cpp b10470" or null.
 */
export function engineBuild(run) {
  const engine = run?.engine || {};
  const name = engine.engineName || null;
  const raw = engine.engineVersion || null;

  if (raw && raw.trim() && !/^see\b/i.test(raw.trim())) {
    return `${name} ${raw.trim()}`;
  }

  // Fall back to free text: notes + command snippet.
  const text = `${run?.notes || ''} ${run?.engineFlags?.commandSnippet || ''}`;
  for (const pattern of BUILD_PATTERNS) {
    const m = text.match(pattern);
    if (m) return `${name} ${m[0]}`;
  }

  // "see Agentic Arcade source metadata" or empty — unknown build.
  return name ? `${name} unknown-build` : null;
}

/**
 * Cohort key: same engine AND same build/version string.
 */
export function cohortKey(run) {
  return engineBuild(run) || 'unknown-engine';
}

/**
 * Count runs per engine cohort and flag mixes.
 * Returns { cohorts: [{ tag, runs }], mixed, tags } sorted by run count.
 */
export function engineCohorts(runs) {
  const counts = new Map();
  for (const run of runs) {
    const tag = cohortKey(run);
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const cohorts = [...counts.entries()]
    .map(([tag, n]) => ({ tag, runs: n }))
    .sort((a, b) => b.runs - a.runs || a.tag.localeCompare(b.tag));
  return {
    cohorts,
    tags: cohorts.map(c => c.tag),
    mixed: cohorts.length > 1
  };
}

/**
 * Visible caution for a mixed-version hardware compare, per issue #29:
 * "comparing b4000 vs b4523 — treat delta with caution".
 * Returns null when both sides share the same cohort.
 */
export function compareWarning(tagA, tagB) {
  if (!tagA || !tagB || tagA === tagB) return null;
  return `comparing ${tagA} vs ${tagB} — treat delta with caution`;
}

/** Distinct engine tags across flattened runs carrying an `engineTag`. */
export function engineTags(runs) {
  return [...new Set(runs.map(r => r?.engineTag || r?.engine || 'unknown-engine'))];
}

/**
 * Cohort summary over flattened API runs that carry a string
 * `engineTag` field ("llama.cpp b10470"). Returns
 * { cohorts: [{ tag, runs }], tags, mixed } sorted by run count.
 */
export function tagCohorts(runs) {
  const counts = new Map();
  for (const run of runs) {
    const tag = run?.engineTag || run?.engine || 'unknown-engine';
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const cohorts = [...counts.entries()]
    .map(([tag, n]) => ({ tag, runs: n }))
    .sort((a, b) => b.runs - a.runs || a.tag.localeCompare(b.tag));
  return { cohorts, tags: cohorts.map(c => c.tag), mixed: cohorts.length > 1 };
}
