// Data-freshness helpers (issue #38): staleness tiers, max_age filtering,
// and major-engine-release boundary warnings.
//
// Inference-stack performance shifts materially across llama.cpp/vLLM
// releases, so every benchmark figure is stamped with the run date, its age
// in days, and a staleness tier:
//   fresh  < 90 days
//   aging  < 365 days
//   stale  >= 365 days
// Runs without a parseable date are tier 'unknown' and are EXCLUDED when a
// max_age filter is requested — an unverifiable date must not pass as fresh.

export const FRESH_DAYS = 90;
export const AGING_DAYS = 365;

/**
 * Dated major engine-version boundaries. When the newest run in a group
 * predates the most recent boundary for its engine, consumers should treat
 * the numbers as describing an older generation of the inference stack.
 * Extend this table as new major releases land; llama.cpp uses rolling
 * build numbers rather than dated majors, so it has no entry yet.
 */
export const MAJOR_ENGINE_RELEASES = [
  {
    engine: 'vLLM',
    version: 'V1',
    date: '2025-01-27', // vLLM V1 core-architecture announcement
    note: 'V1 scheduler/core rewrite'
  }
];

export function parseDate(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Age of a date (or ISO string) relative to `now`, in fractional days. */
export function ageInDays(value, now = new Date()) {
  const d = parseDate(value);
  if (!d) return null;
  return (now.getTime() - d.getTime()) / 86400000;
}

export function stalenessTier(ageDays) {
  if (!Number.isFinite(ageDays)) return 'unknown';
  if (ageDays < FRESH_DAYS) return 'fresh';
  if (ageDays < AGING_DAYS) return 'aging';
  return 'stale';
}

/** Parse a `max_age` query param (days) into a positive finite number or null. */
export function parseMaxAgeParam(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Keep only runs measured within `maxAgeDays` of `now`. Undated runs are dropped. */
export function filterByMaxAge(runs, maxAgeDays, now = new Date()) {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return runs;
  return runs.filter(run => {
    const age = ageInDays(run.createdAt, now);
    return age !== null && age <= maxAgeDays;
  });
}

/**
 * Evaluation instant for max-age filtering (#826): the dataset fetch time the
 * snapshot metadata describes (frozen for pinned snapshots), falling back to
 * the wall clock only when no metadata exists. Filtering against per-request
 * `new Date()` made pinned ?snapshot= replays shrink every day.
 */
export function resolveSnapshotAt(snapshotMeta, fallback = new Date()) {
  const d = parseDate(snapshotMeta?.createdAt);
  return d || fallback;
}

/** Per-run freshness stamp for raw run payloads. */
export function decorateRun(run, now = new Date()) {
  const age = ageInDays(run.createdAt, now);
  return {
    ...run,
    ageDays: age === null ? null : Math.floor(age),
    staleness: stalenessTier(age)
  };
}

/**
 * Warnings for groups whose newest run predates a major engine-version
 * boundary. One warning per engine that has a matching release entry.
 */
export function majorReleaseWarnings(runs, now = new Date(), releases = MAJOR_ENGINE_RELEASES) {
  const newestPerEngine = new Map();
  for (const run of runs) {
    const engine = run.engine;
    if (!engine) continue;
    const d = parseDate(run.createdAt);
    if (!d) continue;
    const current = newestPerEngine.get(engine);
    if (!current || d > current.date) newestPerEngine.set(engine, { date: d, run });
  }

  const warnings = [];
  for (const release of releases) {
    const newest = newestPerEngine.get(release.engine);
    if (!newest) continue;
    const boundary = parseDate(release.date);
    if (boundary && newest.date < boundary) {
      warnings.push({
        engine: release.engine,
        releaseVersion: release.version,
        releaseDate: release.date,
        releaseNote: release.note || null,
        newestRunAt: newest.date.toISOString(),
        message: `Newest ${release.engine} run (${newest.date.toISOString().slice(0, 10)}) predates ${release.engine} ${release.version} (${release.date}${release.note ? `, ${release.note}` : ''}); speeds may not reflect the current engine.`
      });
    }
  }
  return warnings;
}

/**
 * Freshness summary for a group of runs: newest/oldest measurement dates,
 * age of the newest run, its staleness tier, distinct engine versions seen,
 * and any major-release boundary warnings.
 */
export function groupFreshness(runs, now = new Date(), releases = MAJOR_ENGINE_RELEASES) {
  const dates = runs.map(r => parseDate(r.createdAt)).filter(Boolean);
  const newest = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;
  const oldest = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
  const age = newest ? ageInDays(newest, now) : null;

  return {
    newestRunAt: newest ? newest.toISOString() : null,
    oldestRunAt: oldest ? oldest.toISOString() : null,
    newestAgeDays: age === null ? null : Math.floor(age),
    staleness: stalenessTier(age),
    engineVersions: [...new Set(runs.map(r => r.engineVersion).filter(Boolean))],
    majorReleaseWarnings: majorReleaseWarnings(runs, now, releases)
  };
}
