// Shared "did the last localStorage write succeed?" registry (#779).
//
// Every non-snapshot localStorage writer (SLO budgets, theme, concept-check
// quiz answers, curriculum progress, changelog dismissal) historically
// swallowed storage failures silently (`catch {}`). In private browsing or a
// quota-full profile the app kept displaying state that would silently revert
// on reload — SLO verdict badges flip with zero diagnostic trail.
//
// Writers report outcomes here; UI surfaces consult storageStatus() to show a
// persistence warning instead of silently reverting on next load.

let lastFailure = null; // { key, at } | null

/** Canonical key inventory (#751 cross-references this from llms.txt docs). */
export const STORAGE_KEYS = {
  theme: 'llmpd-theme',
  sloBudgets: 'llmpdv.slo-budgets-v1',
  conceptChecks: 'llmpd-concept-checks-v1',
  curriculumProgress: 'llmpd-curriculum-progress',
  changelogDismissed: 'changelog.dismissedId'
};

/** Record that a write to `key` failed (private mode / quota / blocked). */
export function noteStorageFailure(key) {
  lastFailure = { key: String(key), at: Date.now() };
}

/** Record that a write succeeded — clears any earlier failure signal. */
export function noteStorageSuccess() {
  lastFailure = null;
}

/**
 * Current persistence health for UI surfaces.
 * Shape: { available: boolean, failedKey: string|null }.
 */
export function storageStatus() {
  return lastFailure
    ? { available: false, failedKey: lastFailure.key }
    : { available: true, failedKey: null };
}

/** Test/SSR hook: forget all recorded outcomes. */
export function resetStorageHealth() {
  lastFailure = null;
}
