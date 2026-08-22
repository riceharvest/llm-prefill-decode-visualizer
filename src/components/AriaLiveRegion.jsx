import React, { useCallback, useRef, useState } from 'react';
import { createLiveAnnouncer } from '../utils/liveAnnouncer';
import { t } from '../i18n/strings';

/**
 * Polite aria-live region (issue #73): the single DOM node whose text content
 * screen readers announce. Visually hidden but exposed to the accessibility
 * tree; aria-atomic keeps each announcement a single utterance.
 */
export default function AriaLiveRegion({ message }) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" aria-label={t('a11y.liveRegionLabel')}>
      {message}
    </div>
  );
}

/**
 * Hook pairing the live-region state with the throttled announcer from
 * utils/liveAnnouncer. `announce(msg)` speaks the message unless it arrives
 * inside the throttle window; `announce(msg, { force: true })` always speaks
 * (used for completion summaries). Suppressed messages leave the current
 * text untouched, so the SR queue never floods on long agentic runs.
 */
export function useLiveAnnouncer() {
  const [message, setMessage] = useState('');
  const announcerRef = useRef(null);
  if (!announcerRef.current) announcerRef.current = createLiveAnnouncer();
  const announce = useCallback((msg, opts) => {
    const next = announcerRef.current.announce(msg, opts);
    if (next !== null) setMessage(next);
  }, []);
  return { message, announce, announcer: announcerRef.current };
}
