// Changelog / what's-new banner logic (#112).
//
// Pure helpers so the dismissal rules are testable without a DOM. The banner
// component (src/components/ChangelogBanner.jsx) fetches /changelog.json,
// picks the newest entry and shows it until the visitor dismisses it — the
// dismissal is stored in localStorage keyed by that entry's id, so publishing
// a new entry re-arms the banner for everyone.

export const DISMISSAL_STORAGE_KEY = 'changelog.dismissedId';

/**
 * Pick the newest entry from a parsed changelog feed.
 * Entries carry an ISO `date`; ties fall back to feed order (newest first),
 * so a malformed date can never bury the top entry.
 */
export function latestEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  let best = entries[0];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (String(e.date ?? '') > String(best.date ?? '')) best = e;
  }
  return best;
}

/** Read the id of the entry the visitor last dismissed (null when none). */
export function getDismissedId() {
  try {
    return globalThis.localStorage?.getItem(DISMISSAL_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/** Persist a dismissal; silently no-ops without localStorage (tests, SSR). */
export function setDismissedId(id) {
  try {
    globalThis.localStorage?.setItem(DISMISSAL_STORAGE_KEY, String(id));
  } catch {
    // storage full/blocked — banner just comes back next visit
  }
}

/** The banner shows only when there is a newest entry the visitor hasn't dismissed. */
export function shouldShowBanner(entry, dismissedId) {
  return Boolean(entry?.id) && entry.id !== dismissedId;
}
