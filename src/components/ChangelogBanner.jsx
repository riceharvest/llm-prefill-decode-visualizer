import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { demoUrl } from '../utils/urlState';
import {
  latestEntry,
  getDismissedId,
  setDismissedId
} from '../utils/changelog';
import { t } from '../i18n/strings';

/**
 * Dismissible "what's new" banner (#112).
 *
 * Backed by /changelog.json (a versioned feed of features, hardware profiles
 * and notable community runs). The newest entry is announced right below the
 * header and links straight to the tab/permalink where it can be experienced.
 * Dismissing stores that entry's id in localStorage, so the banner stays away
 * until a newer entry is published — silent shipping never re-announces, but
 * new entries always resurface for returning visitors.
 */
export default function ChangelogBanner() {
  const [entry, setEntry] = useState(null);
  const [dismissedId, setDismissedIdState] = useState(getDismissedId);

  useEffect(() => {
    let cancelled = false;
    fetch('/changelog.json')
      .then(res => (res.ok ? res.json() : null))
      .then(feed => {
        if (!cancelled && feed) setEntry(latestEntry(feed.entries));
      })
      .catch(() => {
        // Feed unavailable (offline preview, blocked request) — no banner.
      });
    return () => { cancelled = true; };
  }, []);

  const handleDismiss = useCallback(() => {
    if (!entry?.id) return;
    setDismissedId(entry.id);
    setDismissedIdState(entry.id);
  }, [entry]);

  // Also count an entry as seen when the visitor clicks through to try it.
  const handleTryIt = useCallback(() => {
    handleDismiss();
  }, [handleDismiss]);

  if (!entry || entry.id === dismissedId) return null;

  const href = demoUrl({ tab: entry.link?.tab || 'single', ...(entry.link?.params || {}) });

  return (
    <div className="app-frame">
      <aside className="changelog-banner" role="status">
        <div className="changelog-icon" aria-hidden="true">
          <Sparkles size={15} />
        </div>
        <div className="changelog-body">
          <p className="changelog-meta">
            <span className="changelog-badge">{t('changelog.badge')}</span>
            {entry.version && <span className="changelog-version">v{entry.version}</span>}
            <time dateTime={entry.date}>{entry.date}</time>
          </p>
          <p className="changelog-title">{entry.title}</p>
        </div>
        <div className="changelog-actions">
          <a
            className="btn btn-accent changelog-try"
            href={href}
            onClick={handleTryIt}
          >
            {t('changelog.tryIt')}
            <ArrowRight size={14} />
          </a>
          <button
            onClick={handleDismiss}
            title={t('changelog.dismiss')}
            aria-label={t('changelog.dismiss')}
            className="btn btn-icon"
          >
            <X size={15} />
          </button>
        </div>
      </aside>
    </div>
  );
}
