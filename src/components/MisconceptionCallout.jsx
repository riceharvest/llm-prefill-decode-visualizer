import React from 'react';
import { Lightbulb, X } from 'lucide-react';

// Catalog of misconception callouts. Each entry is surfaced by a specific
// user action (see the visualizers) — never shown as a static FAQ — because a
// correction lands better the moment the user just watched the (non-)effect.
export const MISCONCEPTIONS = {
  'output-length-ttft': {
    title: 'Doubling output length does NOT change TTFT',
    text: 'TTFT is decided entirely by prefill: prompt tokens ÷ prefill speed. Raising the target output length only stretches Phase 2 — the first token still arrives exactly as fast as before.'
  },
  'tpot-throughput': {
    title: 'TPOT ≠ tokens/sec',
    text: 'TPOT is per-token latency inside the decode loop (1000 ÷ decode tok/s). It says nothing about end-to-end throughput, which also includes prefill time and idle gaps between requests.'
  },
  'prefix-caching-first-turn': {
    title: 'Prefix caching does NOT help turn 1',
    text: 'Before the first request there is nothing cached, so turn 1 always prefills the full context at full price. Caching only pays off from turn 2 onward, when turns reuse the accumulated prefix.'
  },
  'chunked-prefill-stall': {
    title: 'An unchunked prefill stalls the WHOLE batch',
    text: 'With chunked prefill off, one prompt ingests in a single engine step that lasts hundreds of milliseconds — every decoding sequence in the batch waits for it. That is exactly the ITL spike chunked prefill exists to prevent.'
  }
};

const DISMISS_KEY = 'misconception-dismissed';

// Dismissals persist for the browser session so a callout fires once and
// never nags again after being closed.
export function isMisconceptionDismissed(id) {
  try {
    return window.sessionStorage.getItem(`${DISMISS_KEY}:${id}`) === '1';
  } catch {
    return false; // storage unavailable (private mode etc.) — just re-show
  }
}

export function dismissMisconception(id) {
  try {
    window.sessionStorage.setItem(`${DISMISS_KEY}:${id}`, '1');
  } catch {
    // storage unavailable — dismissal is in-memory only
  }
}

/**
 * Dismissible amber callout that corrects a common inference misconception.
 * Rendered inline by a visualizer at the moment its trigger condition fires.
 */
export default function MisconceptionCallout({ id, onDismiss }) {
  const misconception = MISCONCEPTIONS[id];
  if (!misconception) return null;

  return (
    <aside className="misconception-callout" role="status" aria-label={`Common misconception: ${misconception.title}`}>
      <Lightbulb size={16} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: '2px' }} />
      <div className="misconception-body">
        <div className="misconception-title">{misconception.title}</div>
        <p className="misconception-text">{misconception.text}</p>
      </div>
      <button
        type="button"
        className="misconception-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss misconception callout"
        title="Dismiss — won't show again this session"
      >
        <X size={14} />
      </button>
    </aside>
  );
}
