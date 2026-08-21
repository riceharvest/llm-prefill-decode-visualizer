import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Play, Pause, Zap, Gauge, FileText, RotateCcw, Image as ImageIcon, FileDown, Copy } from 'lucide-react';
import { formatTime, formatTokens, SCENARIO_PRESETS } from '../utils/presets';
import {
  IMAGE_RESOLUTION_PRESETS,
  TOKENS_PER_TILE,
  estimateImageTiles,
  estimateImageTokens
} from '../utils/multimodal';
import { readParamNum, readParam, readParamBool, writeParams } from '../utils/urlState';
import { DEFAULT_DRAFT_COST, breakevenAcceptance, suggestPairs, pairAcceptance } from '../utils/specDecode';
import { drawItlSamples, summarizeItl, histogramItl, cumulativeItlSchedule, tokensEmittedBy } from '../utils/itl';
import MisconceptionCallout, { isMisconceptionDismissed, dismissMisconception } from './MisconceptionCallout';
import { sanityWarnings } from '../../api/_math.js';
import SanityWarnings from './SanityWarnings';
import Metric from './Metric';

import { buildSingleTurnMarkdown, buildDeepLink, downloadMarkdown, copyMarkdownToClipboard } from '../utils/exportMarkdown';
import { t } from '../i18n/strings';

export default function SingleTurnVisualizer({
  prefillSpeed,
  decodeSpeed,
  simSpeedMultiplier,
  isPlaying,
  setIsPlaying,
  resetKey
}) {
  const [promptTokens, setPromptTokens] = useState(() => readParamNum('prompt', 2048));
  const [outputTokens, setOutputTokens] = useState(() => readParamNum('output', 512));
  // Speculative decoding: draft model proposes k tokens per step, target verifies.
  // Effective tok/s ≈ decodeSpeed × (k+1) × acceptance / (1 + k × acceptance × draftCost)
  // where draftCost is draft-model TPOT as a fraction of target TPOT (~0.15-0.3 typical).
  const [specEnabled, setSpecEnabled] = useState(() => readParamBool('spec', false));
  const [draftTokens, setDraftTokens] = useState(() => Math.max(2, Math.round(readParamNum('draftK', 4))));
  const [acceptance, setAcceptance] = useState(() => {
    const v = readParamNum('acc', 0.7);
    return Math.min(0.95, Math.max(0.3, v));
  });
  // Multimodal attachments: images tile into ~1MP vision-encoder chunks
  // (~1.1K tokens each) that prefill must ingest before the first token.
  const [imagesEnabled, setImagesEnabled] = useState(() => readParamBool('img', false));
  const [imageCount, setImageCount] = useState(() => Math.min(8, Math.max(1, Math.round(readParamNum('imgN', 1)))));
  const [imageResId, setImageResId] = useState(() => {
    const v = readParam('imgRes');
    return IMAGE_RESOLUTION_PRESETS.some(p => p.id === v) ? v : '1080p';
  });
  const imageResolution = IMAGE_RESOLUTION_PRESETS.find(p => p.id === imageResId) || IMAGE_RESOLUTION_PRESETS[1];
  const imageCountSafe = imagesEnabled ? imageCount : 0;
  const imageTokensPerImage = estimateImageTokens(imageResolution);
  const imageTilesPerImage = estimateImageTiles(imageResolution);
  const totalImageTokens = imageTokensPerImage * imageCountSafe;

  // ITL jitter (#56): draw per-token latencies from a seeded distribution so
  // the stream stutters the way real decodes do, then report p50/p95/p99 —
  // an average alone hides exactly the tail latency that ruins streaming UX.
  const [jitterEnabled, setJitterEnabled] = useState(() => readParamBool('jit', false));
  const [jitterPct, setJitterPct] = useState(() => {
    const v = readParamNum('jitPct', 25);
    return Math.min(60, Math.max(5, Math.round(v / 5) * 5));
  });

  const effectiveDecodeSpeed = (() => {
    if (!specEnabled) return decodeSpeed;
    const k = draftTokens;
    const alpha = acceptance;
    const draftCost = DEFAULT_DRAFT_COST; // draft model step costs ~20% of a target step
    const tokensPerStep = 1 + k * alpha;           // accepted drafts + the bonus token
    const stepsPerSecond = decodeSpeed / (1 + k * draftCost);
    return stepsPerSecond * tokensPerStep;
  })();

  // Acceptance rate below which speculation is slower than vanilla decode.
  // In the linear verify-cost model this equals the draft cost fraction (~0.2).
  const breakevenAlpha = breakevenAcceptance(DEFAULT_DRAFT_COST);
  const specHurts = specEnabled && acceptance <= breakevenAlpha;

  const applyPair = (pair) => {
    setDraftTokens(Math.min(8, Math.max(2, pair.suggestedK)));
    setAcceptance(pairAcceptance(pair));
  };

  const activeScenario = SCENARIO_PRESETS.find(s => s.promptTokens === promptTokens && s.outputTokens === outputTokens);

  const applyScenario = (scenario) => {
    setPromptTokens(scenario.promptTokens);
    setOutputTokens(scenario.outputTokens);
    handleReset();
  };

  // Auto-start the simulation when the page was opened via a "try it" demo link
  useEffect(() => {
    if (readParam('autoplay') === '1') {
      const timer = setTimeout(() => setIsPlaying(true), 250);
      return () => clearTimeout(timer);
    }
  }, [setIsPlaying]);

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({
      prompt: promptTokens,
      output: outputTokens,
      spec: specEnabled ? '1' : '',
      draftK: specEnabled ? draftTokens : '',
      acc: specEnabled ? acceptance : '',
      img: imagesEnabled ? '1' : '',
      imgN: imagesEnabled && imageCount !== 1 ? imageCount : '',
      imgRes: imagesEnabled && imageResId !== '1080p' ? imageResId : '',
      jit: jitterEnabled ? '1' : '',
      jitPct: jitterEnabled && jitterPct !== 25 ? jitterPct : ''
    });
  }, [promptTokens, outputTokens, specEnabled, draftTokens, acceptance, imagesEnabled, imageCount, imageResId, jitterEnabled, jitterPct]);

  // Simulation state
  const [phase, setPhase] = useState('idle'); // 'idle' | 'prefilling' | 'decoding' | 'completed'
  const [currentPrefillProgress, setCurrentPrefillProgress] = useState(0); // 0 to promptTokens
  const [currentDecodeTokens, setCurrentDecodeTokens] = useState(0); // 0 to outputTokens
  const [elapsedTime, setElapsedTime] = useState(0); // seconds

  // Calculated benchmarks (typed 0/negative values sanitized for math)
  const safePromptTokens = Math.max(0, promptTokens || 0);
  const safeOutputTokens = Math.max(0, outputTokens || 0);
  // Vision-encoder tokens from attached images are ingested during prefill
  // too — they extend the KV cache before the first text token can emerge.
  const totalPrefillTokens = safePromptTokens + totalImageTokens;
  const expectedTTFT = totalPrefillTokens / prefillSpeed; // seconds
  const tpotMs = effectiveDecodeSpeed > 0 ? 1000 / effectiveDecodeSpeed : Infinity;

  // Per-token ITL draws (seeded ⇒ stable across re-renders and share links).
  // Mean-preserving lognormal: the average TPOT is unchanged, only the tail
  // grows with the variance slider — the p99/mean ratio is the story.
  const ITL_SEED = 20260821;
  const itlCv = jitterEnabled ? jitterPct / 100 : 0;
  const itlSamples = useMemo(
    () => (Number.isFinite(tpotMs) && safeOutputTokens > 0
      ? drawItlSamples({ baseMs: tpotMs, cv: itlCv, count: safeOutputTokens, seed: ITL_SEED })
      : []),
    [tpotMs, itlCv, safeOutputTokens]
  );
  const itlSummary = useMemo(() => summarizeItl(itlSamples), [itlSamples]);
  const itlHistogram = useMemo(
    () => (jitterEnabled ? histogramItl(itlSamples, 28) : null),
    [jitterEnabled, itlSamples]
  );
  // Cumulative emission schedule (ms since decode start) — with jitter on,
  // decode time is the actual sum of drawn latencies instead of a clean line.
  const itlSchedule = useMemo(
    () => (jitterEnabled && Number.isFinite(tpotMs) ? cumulativeItlSchedule(itlSamples) : null),
    [jitterEnabled, tpotMs, itlSamples]
  );

  const expectedDecodeTime = itlSchedule && itlSchedule.length > 0
    ? itlSchedule[itlSchedule.length - 1] / 1000 // spec-aware + jittered: sum of drawn per-token gaps
    : safeOutputTokens / effectiveDecodeSpeed; // seconds (spec-aware)
  const expectedTotalTime = expectedTTFT + expectedDecodeTime;
  const ttftFloorWarnings = sanityWarnings({
    promptTokens: safePromptTokens,
    prefillSpeed,
    decodeSpeed
  }).filter(w => w.code === 'ttft_below_kernel_launch_floor');

  const sampleWords = [
    "The", "architecture", "of", "modern", "Large", "Language", "Models", "relies",
    "on", "transformer", "attention", "mechanisms.", "During", "prefill,", "tokens",
    "are", "processed", "in", "parallel", "to", "construct", "the", "KV", "cache.",
    "During", "decode,", "each", "token", "is", "generated", "autoregressively,", "fetching",
    "weights", "and", "KV", "cache", "from", "high-bandwidth", "VRAM.", "This", "makes",
    "prefill", "compute-bound", "and", "decode", "memory-bound.", "Optimizing", "both",
    "is", "key", "to", "low-latency", "LLM", "inference."
  ];

  // Ref for timer
  const animFrameRef = useRef(null);
  const lastTickRef = useRef(null);
  const simTimeRef = useRef(0); // simulated seconds elapsed

  // Global Reset button (App resetKey) clears ALL sim state
  const resetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      handleReset();
    }
  }, [resetKey]);

  // Reset simulation
  const handleReset = () => {
    setPhase('idle');
    setCurrentPrefillProgress(0);
    setCurrentDecodeTokens(0);
    setElapsedTime(0);
    simTimeRef.current = 0;
    setIsPlaying(false);
  };

  // Start / Resume simulation
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      lastTickRef.current = null;
      return;
    }

    if (phase === 'idle' || phase === 'completed') {
      setPhase('prefilling');
      setCurrentPrefillProgress(0);
      setCurrentDecodeTokens(0);
      setElapsedTime(0);
      simTimeRef.current = 0;
    }

    const tick = (now) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const realDeltaSec = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      // Non-finite walltime (e.g. a speed typed as 0): finish immediately,
      // showing only the phases that can actually complete.
      if (!Number.isFinite(expectedTotalTime) || expectedTotalTime <= 0) {
        setCurrentPrefillProgress(Number.isFinite(expectedTTFT) && expectedTTFT >= 0 ? Math.max(0, totalPrefillTokens) : 0);
        setCurrentDecodeTokens(Number.isFinite(expectedDecodeTime) && expectedDecodeTime >= 0 ? Math.max(0, outputTokens) : 0);
        setElapsedTime(expectedTotalTime);
        setPhase('completed');
        setIsPlaying(false);
        return;
      }

      // Handle instant mode
      if (simSpeedMultiplier === 'instant') {
        setCurrentPrefillProgress(totalPrefillTokens);
        setCurrentDecodeTokens(safeOutputTokens);
        setElapsedTime(expectedTotalTime);
        setPhase('completed');
        setIsPlaying(false);
        return;
      }

      const simDeltaSec = realDeltaSec * simSpeedMultiplier;

      // Advance sim clock via a ref — never dispatch setState from inside a
      // setElapsedTime updater (updaters run during render; side effects in
      // them fire React's "Cannot update a component while rendering" error
      // and can re-apply stale phase/progress after a reset).
      simTimeRef.current += simDeltaSec;
      const newTime = simTimeRef.current;
      setElapsedTime(newTime);

      // Check if in prefill phase
      if (newTime <= expectedTTFT) {
        setPhase('prefilling');
        const prefillProgress = Math.max(0, Math.min(totalPrefillTokens, Math.floor(newTime * prefillSpeed)));
        setCurrentPrefillProgress(prefillProgress);
      } else if (newTime < expectedTotalTime) {
        setPhase('decoding');
        setCurrentPrefillProgress(totalPrefillTokens);
        const decodeProgressTime = newTime - expectedTTFT;
        // With ITL jitter on, token n appears when its cumulative drawn gap
        // elapses (schedule is ms since decode start); otherwise linear rate.
        const decodeCount = itlSchedule
          ? Math.min(safeOutputTokens, tokensEmittedBy(itlSchedule, decodeProgressTime * 1000))
          : Math.max(0, Math.min(safeOutputTokens, Math.floor(decodeProgressTime * effectiveDecodeSpeed)));
        setCurrentDecodeTokens(decodeCount);
      } else {
        // Completed
        setPhase('completed');
        setCurrentPrefillProgress(totalPrefillTokens);
        setCurrentDecodeTokens(safeOutputTokens);
        setElapsedTime(expectedTotalTime);
        setIsPlaying(false);
        return;
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, simSpeedMultiplier, promptTokens, outputTokens, prefillSpeed, decodeSpeed, effectiveDecodeSpeed, expectedTTFT, expectedTotalTime, totalPrefillTokens, safeOutputTokens, itlSchedule]);

  const prefillPct = Number.isFinite(expectedTotalTime) && expectedTotalTime > 0 ? (expectedTTFT / expectedTotalTime) * 100 : 0;
  const decodePct = Number.isFinite(expectedTotalTime) && expectedTotalTime > 0 ? (expectedDecodeTime / expectedTotalTime) * 100 : 0;

  // Live substitutions for the why-explainer popovers (issue #87)
  const ttftSub = `${safePromptTokens.toLocaleString()} tok ÷ ${prefillSpeed.toLocaleString()} tok/s = ${formatTime(expectedTTFT)}`;
  const decodeTimeSub = `${safeOutputTokens.toLocaleString()} tok ÷ ${Math.round(effectiveDecodeSpeed).toLocaleString()} tok/s = ${formatTime(expectedDecodeTime)}`;
  const tpotSub = Number.isFinite(tpotMs)
    ? `1000 ms ÷ ${Math.round(effectiveDecodeSpeed).toLocaleString()} tok/s = ${tpotMs.toFixed(1)} ms`
    : `decode speed is 0 tok/s → ∞ ms`;
  const walltimeSub = `${formatTime(expectedTTFT)} + ${formatTime(expectedDecodeTime)} = ${formatTime(expectedTotalTime)}`;
  const throughputSub = `(${(safePromptTokens + safeOutputTokens).toLocaleString()} tok) ÷ ${formatTime(expectedTotalTime)}`;
  const prefillPctSub = `${formatTime(expectedTTFT)} ÷ ${formatTime(expectedTotalTime)} × 100 = ${prefillPct.toFixed(1)}%`;
  const decodePctSub = `${formatTime(expectedDecodeTime)} ÷ ${formatTime(expectedTotalTime)} × 100 = ${decodePct.toFixed(1)}%`;
  // Markdown walkthrough export (download + clipboard)
  const [mdCopied, setMdCopied] = useState(false);
  const buildMarkdown = () => buildSingleTurnMarkdown({
    promptTokens,
    outputTokens,
    prefillSpeed,
    decodeSpeed,
    specEnabled,
    draftTokens,
    acceptance,
    effectiveDecodeSpeed,
    deepLink: buildDeepLink('single')
  });
  const handleExportMd = () => downloadMarkdown(buildMarkdown(), 'single-turn-simulation.md');
  const handleCopyMd = async () => {
    const ok = await copyMarkdownToClipboard(buildMarkdown());
    if (ok) {
      setMdCopied(true);
      setTimeout(() => setMdCopied(false), 2000);
    }
  };

  // Token stream windowing: derive the visible words from the real decode
  // counter (~2.5 tokens per word) so the stream always tracks the counter,
  // even at high sim multipliers. Fixed-size window clears and refills.
  const TOKENS_PER_WORD = 2.5;
  const WORD_WINDOW = 80;
  const totalStreamWords = Math.floor(Math.max(0, currentDecodeTokens) / TOKENS_PER_WORD);
  const streamLap = Math.floor(totalStreamWords / WORD_WINDOW);
  const streamVisible = totalStreamWords % WORD_WINDOW;
  const streamWordsVisible = totalStreamWords === 0 || streamVisible === 0
    ? []
    : Array.from({ length: streamVisible }, (_, i) => sampleWords[(streamLap * 7 + i) % sampleWords.length]);

  const phaseLabel = phase === 'idle' ? t('singleTurn.phaseIdle')
    : phase === 'prefilling' ? t('singleTurn.phasePrefill')
    : phase === 'decoding' ? t('singleTurn.phaseDecode')
    : t('singleTurn.phaseCompleted');
  const phaseTagClass = phase === 'prefilling' ? 'tag-prefill'
    : phase === 'decoding' || phase === 'completed' ? 'tag-decode' : '';

  // --- Misconception callouts: fire once per session at the teachable moment ---
  const [activeCallouts, setActiveCallouts] = useState([]);
  const fireMisconception = (id) => {
    setActiveCallouts(prev => (
      prev.includes(id) || isMisconceptionDismissed(id) ? prev : [...prev, id]
    ));
  };
  const handleDismissMisconception = (id) => {
    dismissMisconception(id);
    setActiveCallouts(prev => prev.filter(x => x !== id));
  };

  // Trigger: user raises the target output length — TTFT is unaffected.
  const prevOutputRef = useRef(outputTokens);
  useEffect(() => {
    if (outputTokens > prevOutputRef.current) fireMisconception('output-length-ttft');
    prevOutputRef.current = outputTokens;
  }, [outputTokens]);

  // Trigger: the run crosses into the decode phase — TPOT becomes visible.
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (phase === 'decoding' && prevPhaseRef.current !== 'decoding') {
      fireMisconception('tpot-throughput');
    }
    prevPhaseRef.current = phase;
  }, [phase]);


  return (
    <div className="stack">

      {/* Top Parameter Cards */}
      <section className="panel" aria-label={t('singleTurn.paramsPanelAria')}>
        <h2 className="panel-title" style={{ marginBottom: '14px' }}>
          <FileText size={16} />
          <span>{t('singleTurn.paramsPanelTitle')}</span>
        </h2>

        {/* Workload scenario presets */}
        <div className="seg" role="group" aria-label={t('singleTurn.scenarioGroupAria')} style={{ marginBottom: '14px', flexWrap: 'wrap' }}>
          {SCENARIO_PRESETS.map(s => (
            <button
              key={s.id}
              onClick={() => applyScenario(s)}
              className={activeScenario?.id === s.id ? 'active' : ''}
              aria-pressed={activeScenario?.id === s.id}
              title={`${s.promptTokens.toLocaleString()} prompt → ${s.outputTokens.toLocaleString()} output tokens`}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        {/* Speculative decoding toggle */}
        <div className="panel-inset" style={{ marginBottom: '14px', borderColor: specEnabled ? 'var(--agent-border)' : 'var(--border)' }}>
          <div className="field-head" style={{ marginBottom: specEnabled ? '10px' : '0' }}>
            <button
              onClick={() => setSpecEnabled(!specEnabled)}
              className={`seg${specEnabled ? ' active' : ''}`}
              aria-pressed={specEnabled}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '4px 12px', cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${specEnabled ? 'var(--agent-border)' : 'var(--border)'}`,
                background: specEnabled ? 'var(--agent-dim)' : 'var(--bg-inset)',
                color: specEnabled ? 'var(--agent)' : 'var(--text-muted)'
              }}
            >
              ⚡ {t('singleTurn.speculativeDecoding')} {specEnabled ? t('singleTurn.specOn') : t('singleTurn.specOff')}
            </button>
            {specEnabled && (
              <span className="tag tag-decode">
                {t('singleTurn.effectiveTag', {
                  speed: Math.round(effectiveDecodeSpeed).toLocaleString(),
                  multiplier: (effectiveDecodeSpeed / decodeSpeed).toFixed(2)
                })}
              </span>
            )}
          </div>
          {specEnabled && (
            <div className="grid-auto" style={{ '--grid-min': '220px' }}>
              <div className="field">
                <div className="field-head">
                  <span className="field-label">{t('singleTurn.draftTokensPerStep')}</span>
                  <span className="field-value" style={{ color: 'var(--agent)' }}>{draftTokens}</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="8"
                  step="1"
                  value={draftTokens}
                  aria-label={t('singleTurn.draftTokensAria')}
                  onChange={(e) => setDraftTokens(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <div className="field-head">
                  <span className="field-label">{t('singleTurn.acceptanceRate')}</span>
                  <span className="field-value" style={{ color: specHurts ? 'var(--prefill)' : 'var(--agent)' }}>
                    {acceptance.toFixed(2)}
                  </span>                </div>
                <input
                  type="range"
                  min="0.3"
                  max="0.95"
                  step="0.05"
                  value={acceptance}
                  aria-label={t('singleTurn.acceptanceAria')}
                  onChange={(e) => setAcceptance(Number(e.target.value))}
                />
                <div className="field-scale">
                  <span>breakeven α ≈ {breakevenAlpha.toFixed(2)}</span>
                  <span>0.95</span>
                </div>
              </div>
            </div>
          )}
          {specEnabled && (
            <p className="hint-text" style={{ marginTop: '8px', color: specHurts ? 'var(--prefill)' : undefined }}>
              {specHurts
                ? `⚠ α = ${acceptance.toFixed(2)} is at or below the breakeven (${breakevenAlpha.toFixed(2)}): the draft overhead outweighs the accepted tokens — speculation is slower than vanilla decode. Raise α or lower k.`
                : `Draft model proposes k tokens, target verifies in one pass. Effective speed ≈ base ÷ (1 + k·c_draft) × (1 + k·α), draft cost c≈${DEFAULT_DRAFT_COST}. Breakeven α ≈ ${breakevenAlpha.toFixed(2)} — below it speculation hurts.`}            </p>
          )}
          {specEnabled && (
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
              <div className="field-head" style={{ marginBottom: '8px' }}>
                <span className="section-label">Known-good draft / target pairings</span>
                <span className="hint-text" style={{ fontSize: '0.72rem' }}>
                  typical α from community runs · click to apply
                </span>
              </div>
              <div className="grid-auto" style={{ '--grid-min': '260px', gap: '8px' }}>
                {suggestPairs().map(pair => {
                  const active = acceptance === pairAcceptance(pair) && draftTokens === Math.min(8, Math.max(2, pair.suggestedK));
                  return (
                    <button
                      key={pair.id}
                      onClick={() => applyPair(pair)}
                      aria-pressed={active}
                      title={`${pair.source} — sets k=${pair.suggestedK}, α=${pairAcceptance(pair).toFixed(2)}`}
                      style={{
                        textAlign: 'left', cursor: 'pointer',
                        padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${active ? 'var(--agent-border)' : 'var(--border)'}`,
                        background: active ? 'var(--agent-dim)' : 'var(--bg-inset)',
                        color: 'var(--text-main)'
                      }}
                    >
                      <div style={{ fontSize: '0.78rem', fontWeight: 700 }}>
                        {pair.draft} <span style={{ color: 'var(--text-muted)' }}>→</span> {pair.target}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                        α {pair.acceptanceRange[0].toFixed(2)}–{pair.acceptanceRange[1].toFixed(2)} · {pair.speedupRange[0].toFixed(1)}–{pair.speedupRange[1].toFixed(1)}× · k={pair.suggestedK}
                      </div>
                      <div style={{ fontSize: '0.66rem', color: 'var(--text-subtle)', marginTop: '2px' }}>
                        {pair.source}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="hint-text" style={{ marginTop: '8px' }}>
                Acceptance ranges are typical community-reported values for generic chat/code workloads — coding and templated text accepts higher, creative text lower. Measure your own workload before committing.
              </p>
            </div>
          )}
        </div>

        {/* ITL jitter: per-token latency draws + percentile reporting (#56) */}
        <div className="panel-inset" style={{ marginBottom: '14px', borderColor: jitterEnabled ? 'var(--decode-border)' : 'var(--border)' }}>
          <div className="field-head" style={{ marginBottom: jitterEnabled ? '10px' : '0' }}>
            <button
              onClick={() => setJitterEnabled(!jitterEnabled)}
              className={`seg${jitterEnabled ? ' active' : ''}`}
              aria-pressed={jitterEnabled}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '4px 12px', cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${jitterEnabled ? 'var(--decode-border)' : 'var(--border)'}`,
                background: jitterEnabled ? 'var(--decode-dim)' : 'var(--bg-inset)',
                color: jitterEnabled ? 'var(--decode)' : 'var(--text-muted)'
              }}
            >
              ⚡ {t('singleTurn.itlJitterLabel')} {jitterEnabled ? t('singleTurn.specOn') : t('singleTurn.specOff')}
            </button>
            {jitterEnabled && Number.isFinite(itlSummary.mean) && itlSummary.mean > 0 && (
              <span className="tag tag-decode">
                p99/mean ×{(itlSummary.p99 / itlSummary.mean).toFixed(2)}
              </span>
            )}
          </div>
          {jitterEnabled && (
            <>
              <div className="grid-auto" style={{ '--grid-min': '220px' }}>
                <div className="field">
                  <div className="field-head">
                    <span className="field-label">{t('singleTurn.itlVariance')}</span>
                    <span className="field-value" style={{ color: 'var(--decode)' }}>CV {jitterPct}%</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={jitterPct}
                    aria-label={t('singleTurn.itlVarianceAria')}
                    onChange={(e) => {
                      setJitterPct(Number(e.target.value));
                      handleReset();
                    }}
                  />
                  <div className="field-scale">
                    <span>5 · steady</span>
                    <span>25 · shared GPU</span>
                    <span>60 · bursty</span>
                  </div>
                </div>
              </div>
              <p className="hint-text" style={{ marginTop: '8px' }}>
                {t('singleTurn.itlHint')}
              </p>
            </>
          )}
        </div>

        {/* Multimodal attachments */}
        <div className="panel-inset" style={{ marginBottom: '14px', borderColor: imagesEnabled ? 'var(--prefill-border)' : 'var(--border)' }}>
          <div className="field-head" style={{ marginBottom: imagesEnabled ? '10px' : '0' }}>
            <button
              onClick={() => setImagesEnabled(!imagesEnabled)}
              className={`seg${imagesEnabled ? ' active' : ''}`}
              aria-pressed={imagesEnabled}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '4px 12px', cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${imagesEnabled ? 'var(--prefill-border)' : 'var(--border)'}`,
                background: imagesEnabled ? 'var(--prefill-dim)' : 'var(--bg-inset)',
                color: imagesEnabled ? 'var(--prefill)' : 'var(--text-muted)'
              }}
            >
              <ImageIcon size={14} /> Attached Images: {imagesEnabled ? `${imageCount} × ${imageResolution.label}` : 'OFF'}
            </button>
            {imagesEnabled && (
              <span className="tag tag-prefill">
                +{totalImageTokens.toLocaleString()} vision tok
                {' '}({imageTilesPerImage} tile{imageTilesPerImage > 1 ? 's' : ''} ≈ {imageTokensPerImage.toLocaleString()} tok each)
              </span>
            )}
          </div>
          {imagesEnabled && (
            <>
              <div className="grid-auto" style={{ '--grid-min': '220px' }}>
                <div className="field">
                  <div className="field-head">
                    <span className="field-label">Number of images</span>
                    <span className="field-value" style={{ color: 'var(--prefill)' }}>{imageCount}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="8"
                    step="1"
                    value={imageCount}
                    aria-label="Number of attached images"
                    onChange={(e) => {
                      setImageCount(Number(e.target.value));
                      handleReset();
                    }}
                  />
                </div>
                <div className="field">
                  <div className="field-head">
                    <span className="field-label">Resolution</span>
                    <span className="field-value" style={{ color: 'var(--prefill)' }}>
                      {imageResolution.width}×{imageResolution.height}
                    </span>
                  </div>
                  <div className="seg" role="group" aria-label="Image resolution presets" style={{ flexWrap: 'wrap' }}>
                    {IMAGE_RESOLUTION_PRESETS.map(p => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setImageResId(p.id);
                          handleReset();
                        }}
                        className={imageResId === p.id ? 'active' : ''}
                        aria-pressed={imageResId === p.id}
                        title={`${p.width}×${p.height} → ~${estimateImageTokens(p).toLocaleString()} vision tokens`}
                      >
                        {p.id}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="hint-text" style={{ marginTop: '8px' }}>
                Vision-encoder estimate: images are tiled into ~1MP chunks at ~{TOKENS_PER_TILE.toLocaleString()} tokens per tile
                (min 1 tile, capped at 6 tiles/image — matching how hosted VLMs downscale oversized inputs).
                Image tokens join the text prompt in prefill and directly inflate TTFT.
              </p>
            </>
          )}
        </div>

        <div className="grid-auto" style={{ '--grid-min': '280px' }}>
          {/* Prompt Tokens Slider */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('singleTurn.inputPromptLength')}</span>
              <span className="field-value" style={{ color: 'var(--prefill)' }}>
                {formatTokens(promptTokens)} tok
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="128"
                max="32768"
                step="128"
                value={promptTokens}
                aria-label={t('singleTurn.promptLengthAria')}
                onChange={(e) => {
                  setPromptTokens(Number(e.target.value));
                  handleReset();
                }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={promptTokens}
                aria-label={t('singleTurn.promptValueAria')}
                onChange={(e) => {
                  setPromptTokens(Number(e.target.value));
                  handleReset();
                }}
                style={{ width: '80px' }}
              />
            </div>
            <div className="field-scale">
              <span>{t('singleTurn.scalePromptShort')}</span>
              <span>{t('singleTurn.scalePromptRag')}</span>
              <span>{t('singleTurn.scalePromptLongDoc')}</span>
            </div>
          </div>

          {/* Target Output Tokens Slider */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('singleTurn.targetOutputLength')}</span>
              <span className="field-value" style={{ color: 'var(--decode)' }}>
                {formatTokens(outputTokens)} tok
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="32"
                max="4096"
                step="32"
                value={outputTokens}
                aria-label={t('singleTurn.outputLengthAria')}
                onChange={(e) => {
                  setOutputTokens(Number(e.target.value));
                  handleReset();
                }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={outputTokens}
                aria-label={t('singleTurn.outputValueAria')}
                onChange={(e) => {
                  setOutputTokens(Number(e.target.value));
                  handleReset();
                }}
                style={{ width: '80px' }}
              />
            </div>
            <div className="field-scale">
              <span>{t('singleTurn.scaleOutputConcise')}</span>
              <span>{t('singleTurn.scaleOutputStandard')}</span>
              <span>{t('singleTurn.scaleOutputCode')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Misconception callouts (context-triggered, dismissible) */}
      {activeCallouts.map(id => (
        <MisconceptionCallout
          key={id}
          id={id}
          onDismiss={() => handleDismissMisconception(id)}
        />
      ))}

      {/* Main Visualizer Stage */}
      <section className="panel" aria-label={t('singleTurn.simStageAria')}>

        {/* Status Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className={`tag ${phaseTagClass}`} style={{ fontSize: '0.72rem', padding: '3px 9px' }}>
              {phaseLabel}
            </span>
            <span className="hint-text" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {formatTime(elapsedTime)} <span style={{ color: 'var(--text-subtle)' }}>/ {formatTime(expectedTotalTime)}</span>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`btn ${isPlaying ? 'btn-warn' : 'btn-accent'}`}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              {isPlaying ? t('common.pause') : t('common.simulateRun')}
            </button>

            <button
              onClick={handleReset}
              title={t('singleTurn.resetTooltip')}
              className="btn"
            >
              <RotateCcw size={15} />
              {t('common.reset')}
            </button>

            <button
              onClick={handleExportMd}
              title="Export this simulation as a step-by-step markdown walkthrough (download)"
              className="btn"
            >
              <FileDown size={15} />
              Export MD
            </button>

            <button
              onClick={handleCopyMd}
              title="Copy the markdown walkthrough to the clipboard"
              className="btn"
              aria-label="Copy markdown walkthrough to clipboard"
            >
              <Copy size={15} />
              {mdCopied ? 'Copied!' : 'Copy MD'}
            </button>
          </div>
        </div>

        {/* Phase Split Dual Progress Bars */}
        <div className="grid-auto" style={{ '--grid-min': '300px', marginBottom: '20px' }}>

          {/* Prefill Block Visualizer */}
          <div
            className="panel-inset"
            style={{
              borderColor: phase === 'prefilling' ? 'var(--prefill-border)' : 'var(--border)',
              background: phase === 'prefilling' ? 'var(--prefill-dim)' : 'var(--bg-inset)',
              transition: 'background 0.2s ease, border-color 0.2s ease'
            }}
          >
            <div className="field-head" style={{ marginBottom: '4px' }}>
              <span className="panel-title" style={{ color: 'var(--prefill)' }}>
                <Zap size={15} style={{ color: 'var(--prefill)' }} />
                {t('singleTurn.prefillPhaseTitle')}
              </span>
              <span className="tag tag-prefill">{prefillSpeed.toLocaleString()} tok/s</span>
            </div>

            {/* Progress indicator (rAF-driven width — no transition) */}
            <div className="progress-track" style={{ margin: '10px 0 8px' }}>
              <div
                className="progress-fill"
                style={{
                  width: `${totalPrefillTokens > 0 ? Math.min(100, (currentPrefillProgress / totalPrefillTokens) * 100) : 0}%`,
                  background: 'var(--prefill)'
                }}
              />
            </div>

            <div className="field-head" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              <span>Ingested <strong style={{ color: 'var(--text-main)' }}>{currentPrefillProgress.toLocaleString()}</strong> / {totalPrefillTokens.toLocaleString()} tok</span>
              <span>
                TTFT{' '}
                <Metric term="ttft" substitution={ttftSub}>
                  <strong style={{ color: 'var(--prefill)' }}>{formatTime(expectedTTFT)}</strong>
                </Metric>
              </span>
            </div>
            {totalImageTokens > 0 && (
              <div className="field-head" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                <span>{safePromptTokens.toLocaleString()} text + {totalImageTokens.toLocaleString()} vision ({imageCountSafe} img)</span>
                <span>+{formatTime(totalImageTokens / prefillSpeed)} from images</span>
              </div>
            )}

            <p className="hint-text" style={{ marginTop: '8px' }}>
              Compute-bound parallel matrix multiplication. Builds the KV cache for all {totalPrefillTokens.toLocaleString()} prompt tokens{totalImageTokens > 0 ? ` (incl. ${totalImageTokens.toLocaleString()} image tokens)` : ''}.            </p>
          </div>

          {/* Decode Block Visualizer */}
          <div
            className="panel-inset"
            style={{
              borderColor: phase === 'decoding' ? 'var(--decode-border)' : 'var(--border)',
              background: phase === 'decoding' ? 'var(--decode-dim)' : 'var(--bg-inset)',
              transition: 'background 0.2s ease, border-color 0.2s ease'
            }}
          >
            <div className="field-head" style={{ marginBottom: '4px' }}>
              <span className="panel-title" style={{ color: 'var(--decode)' }}>
                <Gauge size={15} style={{ color: 'var(--decode)' }} />
                {t('singleTurn.decodePhaseTitle')}
              </span>
              <span className="tag tag-decode">
                {decodeSpeed.toLocaleString()} tok/s · {Number.isFinite(tpotMs) ? `${tpotMs.toFixed(1)} ms/tok` : '∞ ms/tok'}
              </span>
            </div>

            {/* Progress indicator (rAF-driven width — no transition) */}
            <div className="progress-track" style={{ margin: '10px 0 8px' }}>
              <div
                className="progress-fill"
                style={{
                  width: `${outputTokens > 0 ? Math.min(100, (currentDecodeTokens / outputTokens) * 100) : 0}%`,
                  background: 'var(--decode)'
                }}
              />
            </div>

            <div className="field-head" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              <span>Generated <strong style={{ color: 'var(--text-main)' }}>{currentDecodeTokens.toLocaleString()}</strong> / {outputTokens.toLocaleString()} tok</span>
              <span>
                Decode{' '}
                <Metric term="decodeTime" substitution={decodeTimeSub} align="left">
                  <strong style={{ color: 'var(--decode)' }}>{formatTime(expectedDecodeTime)}</strong>
                </Metric>
              </span>
            </div>

            <p className="hint-text" style={{ marginTop: '8px' }}>
              {t('singleTurn.decodeHint')}
            </p>
          </div>

        </div>

        {/* Dynamic Token Stream & Simulated Output */}
        <div className="panel-inset" style={{ marginBottom: '20px' }}>
          <div className="field-head" style={{ marginBottom: '10px' }}>
            <span className="section-label">
              {t('singleTurn.streamSectionLabel', { count: currentDecodeTokens })}
            </span>
            <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--decode)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              TPOT{' '}
              <Metric term="tpot" substitution={tpotSub}>
                {Number.isFinite(tpotMs) ? `${tpotMs.toFixed(1)} ms` : '∞ ms'}
              </Metric>
            </span>
          </div>

          <div className="stream-box">
            {streamWordsVisible.length === 0 ? (
              <span className="stream-placeholder">
                {phase === 'prefilling'
                  ? t('singleTurn.placeholderPrefilling')
                  : totalStreamWords > 0
                    ? t('singleTurn.placeholderWindowDone', { lap: streamLap })
                    : t('singleTurn.placeholderIdle')}
              </span>
            ) : (
              streamWordsVisible.map((word, idx) => (
                <span
                  key={`${streamLap}-${idx}`}
                  className="animate-token"
                  style={{
                    background: idx === streamWordsVisible.length - 1 ? 'var(--decode-dim)' : 'transparent',
                    color: idx === streamWordsVisible.length - 1 ? 'var(--decode)' : 'var(--text-main)',
                    padding: '0 2px',
                    borderRadius: '3px',
                    fontWeight: idx === streamWordsVisible.length - 1 ? '700' : '400'
                  }}
                >
                  {word}
                </span>
              ))
            )}
            {phase === 'decoding' && <span className="stream-cursor" />}
          </div>

          {/* ITL histogram + percentile readouts (#56): an average TPOT alone
              hides exactly the tail jitter that ruins streaming UX. */}
          {jitterEnabled && itlHistogram && itlHistogram.bins.length > 0 && Number.isFinite(itlSummary.p50) && (
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
              <div className="field-head" style={{ marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                <span className="section-label">{t('singleTurn.itlDistributionLabel')}</span>
                <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {'p50 '}<strong style={{ color: 'var(--text-main)' }}>{itlSummary.p50.toFixed(1)}</strong>
                  {' · p95 '}<strong style={{ color: 'var(--text-main)' }}>{itlSummary.p95.toFixed(1)}</strong>
                  {' · p99 '}<strong style={{ color: 'var(--prefill)' }}>{itlSummary.p99.toFixed(1)}</strong>
                  {' ms'}
                </span>
              </div>

              {(() => {
                const maxBinCount = Math.max(1, ...itlHistogram.bins.map(b => b.count));
                const span = itlHistogram.max - itlHistogram.min;
                const markers = [
                  { key: 'p50', value: itlSummary.p50 },
                  { key: 'p95', value: itlSummary.p95 },
                  { key: 'p99', value: itlSummary.p99 }
                ];
                return (
                  <>
                    <div
                      role="img"
                      aria-label={t('singleTurn.itlHistogramAria')}
                      style={{
                        position: 'relative',
                        height: '64px',
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: '2px',
                        background: 'var(--bg-raised)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px'
                      }}
                    >
                      {itlHistogram.bins.map((b, i) => (
                        <div
                          key={i}
                          data-tooltip={`${b.count.toLocaleString()} tok · ${b.from.toFixed(1)}–${b.to.toFixed(1)} ms`}
                          style={{
                            flex: 1,
                            height: `${Math.max(b.count > 0 ? 3 : 0, (b.count / maxBinCount) * 100)}%`,
                            background: b.to <= itlSummary.p50
                              ? 'var(--decode)'
                              : b.to <= itlSummary.p95 ? 'var(--agent)' : 'var(--prefill)',
                            borderRadius: '1px'
                          }}
                        />
                      ))}
                      {markers.filter(() => span > 0).map(m => (
                        <div
                          key={m.key}
                          title={`${m.key} = ${m.value.toFixed(1)} ms`}
                          style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: `${((m.value - itlHistogram.min) / span) * 100}%`,
                            width: '1px',
                            background: 'var(--text-subtle)'
                          }}
                        />
                      ))}
                    </div>
                    <div className="field-scale">
                      <span>{itlHistogram.min.toFixed(1)} ms</span>
                      <span>mean {itlSummary.mean.toFixed(1)} ms · avg = TPOT, tail = jitter</span>
                      <span>{itlHistogram.max.toFixed(1)} ms</span>
                    </div>
                    <p className="hint-text" style={{ marginTop: '6px' }}>
                      {t('singleTurn.itlStreamHint')}
                    </p>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* Walltime & Performance Breakdown Cards */}
        <SanityWarnings warnings={ttftFloorWarnings} />
        <div className="metric-grid">

          <div className="metric" style={{ borderLeftColor: 'var(--prefill)' }}>
            <div className="metric-label">{t('singleTurn.metricTtft')}</div>
            <div className="metric-value" style={{ color: 'var(--prefill)' }}>
              <Metric term="ttft" substitution={ttftSub}>
                {formatTime(expectedTTFT)}
              </Metric>
            </div>
            <div className="metric-sub">
              {totalImageTokens > 0
                ? `Prefill ${totalPrefillTokens.toLocaleString()} tok (incl. images)`
                : 'Prompt prefill latency'}
            </div>          </div>

          <div className="metric" style={{ borderLeftColor: 'var(--decode)' }}>
            <div className="metric-label">{t('singleTurn.metricTpot')}</div>
            <div className="metric-value" style={{ color: 'var(--decode)' }}>
              <Metric term="tpot" substitution={tpotSub}>
                {Number.isFinite(tpotMs) ? `${tpotMs.toFixed(1)} ms` : '∞ ms'}
              </Metric>
            </div>
            <div className="metric-sub">{t('singleTurn.tokensPerSecSub', { speed: decodeSpeed })}</div>
          </div>

          <div className="metric" style={{ borderLeftColor: 'var(--accent)' }}>
            <div className="metric-label">{t('singleTurn.metricTotalWalltime')}</div>
            <div className="metric-value">
              <Metric term="walltime" substitution={walltimeSub}>
                {formatTime(expectedTotalTime)}
              </Metric>
            </div>
            <div className="metric-sub">{t('singleTurn.metricTotalSub')}</div>
          </div>

          <div className="metric" style={{ borderLeftColor: 'var(--agent)' }}>
            <div className="metric-label">{t('singleTurn.metricThroughput')}</div>
            <div className="metric-value">
              <Metric term="throughput" substitution={throughputSub} align="left">
                {!Number.isFinite(expectedTotalTime)
                  ? '0.0 '
                  : expectedTotalTime > 0
                    ? `${((totalPrefillTokens + outputTokens) / expectedTotalTime).toFixed(1)} `
                    : '— '}
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>tok/s</span>
              </Metric>
            </div>
            <div className="metric-sub">Total tokens ÷ walltime{totalImageTokens > 0 ? ' (incl. vision tokens)' : ''}</div>          </div>

        </div>

        {/* Stacked Walltime Percentage Bar */}
        <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
          <div className="field-head" style={{ marginBottom: '8px' }}>
            <span className="section-label">{t('singleTurn.distributionLabel')}</span>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              Prefill{' '}
              <Metric term="walltimePctPrefill" substitution={prefillPctSub} align="left">
                <strong style={{ color: 'var(--prefill)' }}>{prefillPct.toFixed(1)}%</strong>
              </Metric>
              {' · '}Decode{' '}
              <Metric term="walltimePctDecode" substitution={decodePctSub}>
                <strong style={{ color: 'var(--decode)' }}>{decodePct.toFixed(1)}%</strong>
              </Metric>
            </span>
          </div>

          <div style={{ display: 'flex', height: '20px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
            <div
              style={{
                width: `${prefillPct}%`,
                background: 'var(--prefill)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-ink)',
                fontSize: '0.68rem',
                fontWeight: '700',
                fontFamily: 'var(--font-mono)'
              }}
              data-tooltip={t('singleTurn.segmentPrefillTooltip', { time: formatTime(expectedTTFT), pct: prefillPct.toFixed(1) })}
            >
              {prefillPct > 8 && `${t('singleTurn.distributionPrefill').toUpperCase()} ${prefillPct.toFixed(0)}%`}
            </div>
            <div
              style={{
                width: `${decodePct}%`,
                background: 'var(--decode)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-ink)',
                fontSize: '0.68rem',
                fontWeight: '700',
                fontFamily: 'var(--font-mono)'
              }}
              data-tooltip={t('singleTurn.segmentDecodeTooltip', { time: formatTime(expectedDecodeTime), pct: decodePct.toFixed(1) })}
            >
              {decodePct > 8 && `${t('singleTurn.distributionDecode').toUpperCase()} ${decodePct.toFixed(0)}%`}
            </div>
          </div>
        </div>

      </section>

    </div>
  );
}
