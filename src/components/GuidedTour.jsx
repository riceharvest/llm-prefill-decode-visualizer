import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Lightbulb, ChevronRight, CheckCircle2 } from 'lucide-react';
import { useFocusTrap } from '../utils/focus';

// First-run guided tour (issue #193). A 5-step spotlight tour that teaches the
// two-phase model of LLM inference by having the user drive the sim themselves:
// prefill slider → TTFT, decode slider → TPOT, prefix caching toggle, theory tab.
// No external tour library — a fixed-position spotlight div with a huge
// box-shadow "cutout" plus a floating card. Interactions stay live so each
// step auto-advances once the user actually performs it.

const STORAGE_KEY = 'llmpd-guided-tour-seen';

export function hasSeenTour() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true; // storage unavailable (private mode) — never nag
  }
}

export function markTourSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // ignore — tour just shows again next visit
  }
}

const STEPS = [
  {
    id: 'prefill',
    tab: 'single',
    target: 'prefill-slider',
    title: 'Prefill speed sets TTFT',
    body: 'Drag the Prefill Speed slider and watch time-to-first-token in the waterfall below move with it.',
    takeaway: 'Prefill ingests every prompt token in parallel, so faster prefill means a faster first token.'
  },
  {
    id: 'decode',
    tab: 'single',
    target: 'decode-slider',
    title: 'Decode speed sets TPOT',
    body: 'Now drag the Decode Speed slider and watch the per-token time change.',
    takeaway: 'Decode generates strictly one token per step, so it sets the pace of every token after the first.'
  },
  {
    id: 'caching',
    tab: 'agentic',
    target: 'prefix-caching',
    title: 'Prefix caching kills repeat prefill',
    body: 'Toggle Prefix caching OFF and back ON in this panel — without it, every turn re-prefills the entire conversation history.',
    takeaway: 'With a cached prefix, each new turn only prefills its new tokens, keeping walltime flat as the loop grows.'
  },
  {
    id: 'theory',
    tab: null, // stay put; spotlight the Theory tab button itself
    target: 'tab-theory',
    title: 'Why do the phases differ?',
    body: 'Click the Theory tab to see the hardware story behind prefill vs decode.',
    takeaway: 'Prefill is compute-bound (big parallel GEMMs); decode is bandwidth-bound (streaming weights + KV cache from VRAM).'
  },
  {
    id: 'done',
    tab: 'theory',
    target: null,
    title: "You're all set",
    body: 'You just drove the two-phase model yourself: prompt ingestion (prefill) sets TTFT, token-by-token generation (decode) sets TPOT, and prefix caching removes repeated prefill work.',
    takeaway: null
  }
];

export default function GuidedTour({ activeTab, setActiveTab, prefillSpeed, decodeSpeed, onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  // WAI-ARIA dialog pattern: while the tour is open, Tab cycles inside the
  // tour card and closing restores focus to whoever opened it.
  const cardRef = useRef(null);
  useFocusTrap(cardRef, true);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const advance = useCallback(() => {
    setStepIndex(i => Math.min(i + 1, STEPS.length - 1));
  }, []);

  const finish = useCallback(() => {
    markTourSeen();
    onClose();
  }, [onClose]);

  // Each step lives on a specific tab — switch there when entering the step.
  useEffect(() => {
    if (step.tab && activeTab !== step.tab) setActiveTab(step.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  // Measure the spotlight target after the (possibly tab-switched) render settles.
  useEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) return; // retried below until found
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    if (!step.target) {
      measure();
      return () => { cancelled = true; };
    }
    // Tab content mounts a frame late; probe a few times before giving up.
    const timers = [60, 180, 400].map(ms => setTimeout(measure, ms));
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [stepIndex, activeTab, step.target]);

  // Step 1 auto-advances when the user actually moves the prefill slider.
  const prevPrefill = useRef(prefillSpeed);
  useEffect(() => {
    if (stepIndex !== 0) {
      prevPrefill.current = prefillSpeed;
      return;
    }
    if (prefillSpeed !== prevPrefill.current) {
      prevPrefill.current = prefillSpeed;
      advance();
    }
  }, [prefillSpeed, stepIndex, advance]);

  // Step 2 same for the decode slider.
  const prevDecode = useRef(decodeSpeed);
  useEffect(() => {
    if (stepIndex !== 1) {
      prevDecode.current = decodeSpeed;
      return;
    }
    if (decodeSpeed !== prevDecode.current) {
      prevDecode.current = decodeSpeed;
      advance();
    }
  }, [decodeSpeed, stepIndex, advance]);

  // Step 3 advances on any click inside the prefix-caching toggle.
  useEffect(() => {
    if (stepIndex !== 2) return;
    const onClick = (e) => {
      if (e.target.closest?.('[data-tour="prefix-caching"]')) advance();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [stepIndex, advance]);

  // Step 4 advances once the Theory tab is actually opened.
  useEffect(() => {
    if (stepIndex === 3 && activeTab === 'theory') advance();
  }, [activeTab, stepIndex, advance]);

  // Escape skips the whole tour.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  // Tooltip placement: under the target when it fits, else above; clamped to viewport.
  const CARD_W = Math.min(360, window.innerWidth - 24);
  const CARD_H = 210;
  let cardStyle;
  if (!rect) {
    // Final step: centered card over a plain backdrop.
    cardStyle = {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)'
    };
  } else {
    const placeBelow = rect.top + rect.height + CARD_H + 16 < window.innerHeight || rect.top < CARD_H + 16;
    const top = placeBelow ? rect.top + rect.height + 12 : rect.top - CARD_H - 12;
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - CARD_W / 2, window.innerWidth - CARD_W - 12));
    cardStyle = { top, left, width: CARD_W, transform: 'none' };
  }

  return (
    <>
      {/* Dimming layer: full-screen backdrop for the final step, spotlight cutout otherwise */}
      {!rect && !isLast ? (
        <div className="tour-backdrop" />
      ) : (
        rect && (
          <div
            className="tour-spotlight"
            style={{
              top: rect.top - 6,
              left: rect.left - 6,
              width: rect.width + 12,
              height: rect.height + 12
            }}
          />
        )
      )}
      {isLast && <div className="tour-backdrop" />}

      <div ref={cardRef} className="tour-card" style={cardStyle} role="dialog" aria-modal="true" aria-label={`Guided tour step ${stepIndex + 1} of ${STEPS.length}`} tabIndex={-1}>
        <div className="tour-card-head">
          <span className="tour-step-count">{stepIndex + 1} / {STEPS.length}</span>
          <button
            onClick={finish}
            className="btn btn-icon"
            aria-label="Skip guided tour"
            title="Skip tour"
          >
            <X size={15} />
          </button>
        </div>

        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>

        {step.takeaway && (
          <p className="tour-takeaway">
            <Lightbulb size={14} style={{ flexShrink: 0, color: 'var(--agent)' }} />
            <span>{step.takeaway}</span>
          </p>
        )}

        <div className="tour-card-foot">
          <div className="tour-dots" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s.id} className={`tour-dot${i <= stepIndex ? ' done' : ''}`} />
            ))}
          </div>
          {isLast ? (
            <button onClick={finish} className="btn btn-accent">
              <CheckCircle2 size={15} />
              Finish
            </button>
          ) : (
            <button onClick={advance} className="btn">
              Next
              <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
