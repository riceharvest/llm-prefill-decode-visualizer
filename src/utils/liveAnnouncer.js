// Issue #73 — screen-reader announcements for simulation progress.
//
// The visualizers stream a purely visual rAF animation; without a live region
// a screen-reader user gets zero feedback about what a run is doing. This
// module builds the announcement strings and provides a throttled announcer
// so long agentic loops (one prefill+decode pair per turn) can't spam the SR
// queue — intermediate messages are dropped when they arrive faster than
// MIN_INTERVAL_MS, while completion summaries always force through.
//
// Consumers render the returned message into a polite aria-live region
// (see <AriaLiveRegion/>).

import { formatTime, formatTokens } from './presets.js';
import { t } from '../i18n/strings.js';

// Minimum real time between two *intermediate* announcements. Completion
// summaries bypass this via { force: true }.
export const ANNOUNCE_MIN_INTERVAL_MS = 5000;

export function createLiveAnnouncer({ minIntervalMs = ANNOUNCE_MIN_INTERVAL_MS } = {}) {
  let lastAnnouncedAt = -Infinity;
  let lastMessage = null;
  return {
    /**
     * Queue a message. Returns the message when it should be spoken, or null
     * when it was suppressed (throttled, or identical to the previous one —
     * an unchanged live-region text is never re-announced anyway).
     */
    announce(message, { force = false, now = Date.now() } = {}) {
      if (!message) return null;
      if (force) {
        lastAnnouncedAt = now;
        lastMessage = message;
        return message;
      }
      if (message === lastMessage) return null;
      if (now - lastAnnouncedAt < minIntervalMs) return null;
      lastAnnouncedAt = now;
      lastMessage = message;
      return message;
    },
    /** Drop throttle state (e.g. on sim reset) so the next run announces promptly. */
    reset() {
      lastAnnouncedAt = -Infinity;
      lastMessage = null;
    }
  };
}

// --- Message builders -------------------------------------------------------

export function buildPrefillAnnouncement(prefillTokens) {
  return t('a11y.prefilling', { tokens: formatTokens(prefillTokens) });
}

export function buildDecodeAnnouncement() {
  return t('a11y.decoding');
}

// One TPOT formatter for every surface (#551): the done line used Math.round
// ("TPOT 10 ms") while the decode-phase header and phase panel render
// tpotMs.toFixed(1) ("9.5 ms/tok" / "TPOT 9.5 ms") — the same quantity at two
// precisions in one view, and neither matched the API's 9.52381. All surfaces
// now share this 1-decimal format so scraped text agrees with /api/compute.
export function formatTpotMs(tpotMs) {
  return Number.isFinite(tpotMs) ? `${tpotMs.toFixed(1)} ms` : '∞ ms';
}

// "Done: TTFT 0.40s, TPOT 18.0 ms, total 9.21s"
export function buildDoneAnnouncement({ ttftSec, tpotMs, totalSec }) {
  return t('a11y.doneSummary', {
    ttft: formatTime(ttftSec),
    tpot: formatTpotMs(tpotMs),
    total: formatTime(totalSec)
  });
}

// "Turn 3 of 12: decoding…"
export function buildTurnAnnouncement({ turn, turns, phase }) {
  const key = phase === 'decoding' ? 'a11y.turnDecoding' : 'a11y.turnPrefilling';
  return t(key, { turn, turns });
}

// "Done: 4 turns, TTFT …, TPOT …, total …"
export function buildAgenticDoneAnnouncement({ turns, ttftSec, tpotMs, totalSec }) {
  return t('a11y.agenticDoneSummary', {
    turns,
    ttft: formatTime(ttftSec),
    tpot: formatTpotMs(tpotMs),
    total: formatTime(totalSec)
  });
}
