import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Play, Pause, Zap, Gauge, FileText, RotateCcw, Image as ImageIcon, FileDown, Copy, FileJson } from 'lucide-react';
import { formatTime, formatTokens, SCENARIO_PRESETS } from '../utils/presets';
import {
  IMAGE_RESOLUTION_PRESETS,
  TOKENS_PER_TILE,
  estimateImageTiles,
  estimateImageTokens
} from '../utils/multimodal';
import { readParamNum, readParam, readParamBool, consumeAutoplay, writeParams } from '../utils/urlState';
import { shouldCompleteInstantly } from '../utils/simPlayback';
import { phaseToRunState, runStateToBusy } from '../utils/viewState';
import { buildDecayCurveSamples } from '../utils/ctxDecayCurve';
import { throughputAnchor, ttftAnchor, tpotAnchor, walltimeAnchor } from '../utils/readingAnchors';
import ChartDataTable from './ChartDataTable';
import { DEFAULT_DRAFT_COST, breakevenAcceptance, suggestPairs, pairAcceptance } from '../utils/specDecode';
import { drawItlSamples, summarizeItl, histogramItl, cumulativeItlSchedule, tokensEmittedBy } from '../utils/itl';
import {
  DEFAULT_HALF_SPEED_CONTEXT,
  HALF_SPEED_CONTEXT_PRESETS,
  decodeSpeedAtContext,
  scaledDecodeTime,
  averageScaledSpeed,
  tokensGeneratedAt
} from '../utils/contextScaling';
import MisconceptionCallout, { isMisconceptionDismissed, dismissMisconception } from './MisconceptionCallout';
import AriaLiveRegion, { useLiveAnnouncer } from './AriaLiveRegion';
import {
  buildPrefillAnnouncement,
  buildDecodeAnnouncement,
  buildDoneAnnouncement
} from '../utils/liveAnnouncer';
import KVCacheMatrix, { KVCacheSectionHeader } from './KVCacheMatrix';
import usePrefersReducedMotion from '../utils/usePrefersReducedMotion';
import { sanityWarnings } from '../../api/_math.js';
import SanityWarnings from './SanityWarnings';
import Metric from './Metric';
import Analogy from './Analogy';
import SloBadge from './SloBadge';
import { evaluateSlo } from '../utils/slo.js';

import { buildSingleTurnMarkdown, buildDeepLink, downloadMarkdown, copyMarkdownToClipboard } from '../utils/exportMarkdown';
import { buildSingleTurnJson, downloadJson, serializeJson, MAX_SERIES_TOKENS } from '../utils/exportJson';
import { resolveActiveScenario } from '../utils/scenarioState';
import { t } from '../i18n/strings';
import { runStateAttrs, phaseTagClass as phaseTagClassFor } from '../utils/runState';

// Workload slider bounds — shared by the range inputs, the number twins
// (issue #409: min/max attributes + clamped commit) and the URL loaders.
export const PROMPT_TOKENS_RANGE = { min: 128, max: 32768, step: 128 };
export const OUTPUT_TOKENS_RANGE = { min: 32, max: 4096, step: 32 };
import { fmtEn } from '../utils/numfmt';

export default function SingleTurnVisualizer({
  prefillSpeed,
  decodeSpeed,
  simSpeedMultiplier,
  isPlaying,
  setIsPlaying,
  resetKey,
  sloBudgets,
  // Optional workload props (#414): when App owns prompt/output state it passes
  // them down so snapshots/undo/share links can carry the workload. Embed and
  // other standalone callers fall back to internal state read from the URL.
  promptTokens: promptTokensProp,
  setPromptTokens: setPromptTokensProp,
  outputTokens: outputTokensProp,
  setOutputTokens: setOutputTokensProp,
  engineFlags,
  lmxProvenance: lmxProvenanceBlock
}) {
  const [localPromptTokens, setLocalPromptTokens] = useState(
    () => clampNum(readParamNum('prompt', 2048), PROMPT_TOKENS_RANGE.min, PROMPT_TOKENS_RANGE.max)
  );
  const [localOutputTokens, setLocalOutputTokens] = useState(
    () => clampNum(readParamNum('output', 512), OUTPUT_TOKENS_RANGE.min, OUTPUT_TOKENS_RANGE.max)
  );
  const promptTokens = promptTokensProp ?? localPromptTokens;
  const setPromptTokens = setPromptTokensProp ?? setLocalPromptTokens;
  const outputTokens = outputTokensProp ?? localOutputTokens;
  const setOutputTokens = setOutputTokensProp ?? setLocalOutputTokens;

  // Issue #409: number twins clamp to the slider range on commit so the field
  // never shows a value the simulation is not using. Empty/garbage input keeps
  // the current value (standard controlled-input behaviour).
  const commitTokenNumber = (setter, { min, max }) => (e) => {
    if (e.target.value === '') return;
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    setter(clampNum(n, min, max));
    handleReset();
  };

  // Issue #412: the C½ control is an integer index into HALF_SPEED_CONTEXT_
  // PRESETS; the number twin accepts exact token targets and snaps to the
  // nearest modeled depth so agents don't have to probe all five steps.
  const nearestHalfSpeedContext = (tokens) => HALF_SPEED_CONTEXT_PRESETS.reduce(
    (best, v) => (Math.abs(v - tokens) < Math.abs(best - tokens) ? v : best),
    HALF_SPEED_CONTEXT_PRESETS[0]
  );
  const commitHalfContextNumber = (e) => {
    if (e.target.value === '') return;
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    setCtxHalf(nearestHalfSpeedContext(n));
    handleReset();
  };
  // Speculative decoding: draft model proposes k tokens per step, target verifies.
  // Effective tok/s ≈ decodeSpeed × (k+1) × acceptance / (1 + k × acceptance × draftCost)
  // where draftCost is draft-model TPOT as a fraction of target TPOT (~0.15-0.3 typical).
  const [specEnabled, setSpecEnabled] = useState(() => readParamBool('spec', false));
  const [draftTokens, setDraftTokens] = useState(() => Math.max(2, Math.round(readParamNum('draftK', 4))));
  const [acceptance, setAcceptance] = useState(() => {
    const v = readParamNum('acc', 0.7);
    return Math.min(0.95, Math.max(0.3, v));
  });
  // Context-length scaling: decode slows as the KV cache fills. One knob, C½
  // (the cache depth at which speed has halved) — see utils/contextScaling.js.
  const [ctxScaleEnabled, setCtxScaleEnabled] = useState(() => readParamBool('ctx', false));
  const [ctxHalf, setCtxHalf] = useState(() => Math.max(1024, readParamNum('ctxHalf', DEFAULT_HALF_SPEED_CONTEXT)));
  // Draggable depth probe on the decay curve (generated tokens); null = midpoint.
  const [probeTokens, setProbeTokens] = useState(null);
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

  // Active scenario (#475): an explicit ?scenario=<id> wins so preset
  // identity survives token tweaks and share links; legacy reverse-inference
  // by exact token-count match stays as fallback.
  const activeScenario = resolveActiveScenario({
    scenarios: SCENARIO_PRESETS,
    urlScenarioId: readParam('scenario'),
    promptTokens,
    outputTokens
  });

  const applyScenario = (scenario) => {
    setPromptTokens(scenario.promptTokens);
    setOutputTokens(scenario.outputTokens);
    handleReset();
  };

  // Auto-start the simulation when the page was opened via a "try it" demo link
  // (#818: consume the flag once per page load so returning to this tab later
  // doesn't re-fire autoplay).
  useEffect(() => {
    if (consumeAutoplay()) {
      const timer = setTimeout(() => setIsPlaying(true), 250);
      return () => clearTimeout(timer);
    }
  }, [setIsPlaying]);

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({
      scenario: activeScenario ? activeScenario.id : '',
      prompt: promptTokens,
      output: outputTokens,
      spec: specEnabled ? '1' : '',
      draftK: specEnabled ? draftTokens : '',
      acc: specEnabled ? acceptance : '',
      ctx: ctxScaleEnabled ? '1' : '',
      ctxHalf: ctxScaleEnabled && ctxHalf !== DEFAULT_HALF_SPEED_CONTEXT ? ctxHalf : '',
      img: imagesEnabled ? '1' : '',
      imgN: imagesEnabled && imageCount !== 1 ? imageCount : '',
      imgRes: imagesEnabled && imageResId !== '1080p' ? imageResId : '',
      jit: jitterEnabled ? '1' : '',
      jitPct: jitterEnabled && jitterPct !== 25 ? jitterPct : ''
    });
  }, [promptTokens, outputTokens, activeScenario, specEnabled, draftTokens, acceptance, ctxScaleEnabled, ctxHalf, imagesEnabled, imageCount, imageResId, jitterEnabled, jitterPct]);

  // Simulation state
  const [phase, setPhase] = useState('idle'); // 'idle' | 'prefilling' | 'decoding' | 'completed'
  const [currentPrefillProgress, setCurrentPrefillProgress] = useState(0); // 0 to promptTokens
  const [currentDecodeTokens, setCurrentDecodeTokens] = useState(0); // 0 to outputTokens
  const [elapsedTime, setElapsedTime] = useState(0); // seconds

  // Issue #73: throttled screen-reader announcements (polite live region).
  const { message: liveMessage, announce, announcer: liveAnnouncer } = useLiveAnnouncer();

  // Calculated benchmarks (typed 0/negative values sanitized for math)
  const safePromptTokens = Math.max(0, promptTokens || 0);
  const safeOutputTokens = Math.max(0, outputTokens || 0);
  // Vision-encoder tokens from attached images are ingested during prefill
  // too — they extend the KV cache before the first text token can emerge.
  const totalPrefillTokens = safePromptTokens + totalImageTokens;
  // Zero-prompt guard (#846): mirror of api/_math.js singleTurn — a 0/0
  // prompt/prefill combination means "no prefill phase" (TTFT 0), not NaN.
  const expectedTTFT = totalPrefillTokens > 0
    ? (prefillSpeed > 0 ? totalPrefillTokens / prefillSpeed : Infinity) // seconds
    : 0;
  // Context scaling: token i of the output is produced with the KV cache at
  // depth totalPrefillTokens + i, so per-token time grows linearly and the
  // decode phase no longer runs at a single constant speed. Walltime uses the
  // closed form; the sim clock inverts it. Disabled → plain n / speed.
  const ctxHalfSafe = Math.max(1024, ctxHalf || DEFAULT_HALF_SPEED_CONTEXT);
  const avgDecodeSpeed = ctxScaleEnabled && safeOutputTokens > 0
    ? averageScaledSpeed(effectiveDecodeSpeed, totalPrefillTokens, safeOutputTokens, ctxHalfSafe)
    : effectiveDecodeSpeed;
  // Average per-token time under context scaling feeds the ITL draws below
  // (mean-preserving), and the closed-form walltime is the jitter-off baseline.
  const ctxScaledDecodeTime = ctxScaleEnabled && safeOutputTokens > 0
    ? scaledDecodeTime(effectiveDecodeSpeed, totalPrefillTokens, safeOutputTokens, ctxHalfSafe)
    : safeOutputTokens / effectiveDecodeSpeed;
  const tpotMs = ctxScaledDecodeTime > 0 ? (1000 * ctxScaledDecodeTime) / Math.max(1, safeOutputTokens) : Infinity;

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
    : ctxScaledDecodeTime; // seconds (spec-aware, context-scaled when enabled)
  const expectedTotalTime = expectedTTFT + expectedDecodeTime;

  // SLO check (issue #64): compare this run's TTFT / TPOT / walltime against
  // the user's persisted budgets. Disabled budgets evaluate to null → no badge.
  const sloResults = evaluateSlo(
    { ttftSec: expectedTTFT, tpotMs, walltimeSec: expectedTotalTime },
    sloBudgets
  );

  // TTFT-below-kernel-launch-floor check (speed rooflines are already flagged
  // globally in SpeedControls; this one needs this tab's prompt length).
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
    liveAnnouncer.reset();
    setIsPlaying(false);
  };

  const prefersReducedMotion = usePrefersReducedMotion();

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

    // Complete synchronously when no animation frame is needed (#1079):
    // ?sim=instant and prefers-reduced-motion used to jump-to-final from
    // INSIDE the rAF tick, which hidden/background tabs never service —
    // both hatches hung forever there. Same completions, same precedence
    // order as the tick body had, but before any rAF is armed.
    if (!Number.isFinite(expectedTotalTime) || expectedTotalTime <= 0) {
      setCurrentPrefillProgress(Number.isFinite(expectedTTFT) && expectedTTFT >= 0 ? Math.max(0, totalPrefillTokens) : 0);
      setCurrentDecodeTokens(Number.isFinite(expectedDecodeTime) && expectedDecodeTime >= 0 ? Math.max(0, outputTokens) : 0);
      setElapsedTime(expectedTotalTime);
      setPhase('completed');
      setIsPlaying(false);
      return;
    }
    if (shouldCompleteInstantly(simSpeedMultiplier, prefersReducedMotion)) {
      setCurrentPrefillProgress(totalPrefillTokens);
      setCurrentDecodeTokens(safeOutputTokens);
      setElapsedTime(expectedTotalTime);
      setPhase('completed');
      setIsPlaying(false);
      return;
    }

    const tick = (now) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const realDeltaSec = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

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
        // elapses (schedule is ms since decode start). With context scaling
        // the rate decays as the cache grows, so progress is the (quadratic)
        // inverse of walltime; otherwise linear rate.
        const decodeCount = Math.max(0, Math.min(safeOutputTokens,
          itlSchedule
            ? tokensEmittedBy(itlSchedule, decodeProgressTime * 1000)
            : ctxScaleEnabled
              ? Math.floor(tokensGeneratedAt(effectiveDecodeSpeed, totalPrefillTokens, decodeProgressTime, ctxHalfSafe))
              : Math.floor(decodeProgressTime * effectiveDecodeSpeed)
        ));
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
  }, [isPlaying, simSpeedMultiplier, prefersReducedMotion, promptTokens, outputTokens, prefillSpeed, decodeSpeed, effectiveDecodeSpeed, expectedTTFT, expectedTotalTime, totalPrefillTokens, safeOutputTokens, itlSchedule, ctxScaleEnabled, ctxHalfSafe]);

  const prefillPct = Number.isFinite(expectedTotalTime) && expectedTotalTime > 0 ? (expectedTTFT / expectedTotalTime) * 100 : 0;
  const decodePct = Number.isFinite(expectedTotalTime) && expectedTotalTime > 0 ? (expectedDecodeTime / expectedTotalTime) * 100 : 0;

  // --- Context-scaling decay curve + draggable depth probe (issue #55 task) ---
  const probeGen = Math.min(safeOutputTokens, Math.max(0, probeTokens ?? Math.floor(safeOutputTokens / 2)));
  const ctxPresetIndex = HALF_SPEED_CONTEXT_PRESETS.reduce(
    (best, v, i) => (Math.abs(v - ctxHalfSafe) < Math.abs(HALF_SPEED_CONTEXT_PRESETS[best] - ctxHalfSafe) ? i : best),
    0
  );
  const CHART_W = 640;
  const CHART_H = 170;
  const PAD_L = 56;
  const PAD_R = 14;
  const PAD_T = 16;
  const PAD_B = 26;
  const innerW = CHART_W - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_T - PAD_B;
  const chartMaxGen = Math.max(1, safeOutputTokens);
  const instantSpeedAt = (genTok) =>
    decodeSpeedAtContext(effectiveDecodeSpeed, totalPrefillTokens + genTok, ctxHalfSafe);
  const curveStartSpeed = ctxScaleEnabled ? instantSpeedAt(0) : effectiveDecodeSpeed;
  const curveEndSpeed = ctxScaleEnabled ? instantSpeedAt(chartMaxGen) : effectiveDecodeSpeed;
  const xAt = (g) => PAD_L + (g / chartMaxGen) * innerW;
  const yHi = Math.max(effectiveDecodeSpeed, 1) * 1.05;
  const yLo = Math.max(0, curveEndSpeed - Math.max((curveStartSpeed - curveEndSpeed) * 0.08, effectiveDecodeSpeed * 0.03));
  const yAt = (s) => PAD_T + (1 - (Math.min(Math.max(s, yLo), yHi) - yLo) / Math.max(yHi - yLo, 1e-9)) * innerH;
  const curveSamples = buildDecayCurveSamples({
    maxGen: chartMaxGen,
    scaleEnabled: ctxScaleEnabled,
    baseSpeed: effectiveDecodeSpeed,
    prefillTokens: totalPrefillTokens,
    ctxHalf: ctxHalfSafe
  });
  const curvePoints = curveSamples
    .map((p) => `${xAt(p.gen).toFixed(1)},${yAt(p.tokps).toFixed(1)}`)
    .join(' ');
  const probeSpeed = ctxScaleEnabled ? instantSpeedAt(probeGen) : effectiveDecodeSpeed;
  const probePctOfBase = effectiveDecodeSpeed > 0 ? (probeSpeed / effectiveDecodeSpeed) * 100 : 0;
  const decaySvgRef = useRef(null);
  const moveProbeToClientX = (clientX) => {
    const svg = decaySvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const px = ((clientX - rect.left) * CHART_W) / rect.width;
    const frac = Math.min(1, Math.max(0, (px - PAD_L) / innerW));
    setProbeTokens(Math.round(frac * chartMaxGen));
  };
  const displayDecodeSpeed = Math.round(avgDecodeSpeed || 0);

  // Live substitutions for the why-explainer popovers (issue #87)
  const ttftSub = `${safePromptTokens.toLocaleString()} tok ÷ ${prefillSpeed.toLocaleString()} tok/s = ${formatTime(expectedTTFT)}`;
  const decodeTimeSub = `${safeOutputTokens.toLocaleString()} tok ÷ ${displayDecodeSpeed.toLocaleString()} tok/s = ${formatTime(expectedDecodeTime)}`;
  const tpotSub = Number.isFinite(tpotMs)
    ? `1000 ms ÷ ${displayDecodeSpeed.toLocaleString()} tok/s = ${tpotMs.toFixed(1)} ms`
    : `decode speed is 0 tok/s → ∞ ms`;
  const walltimeSub = `${formatTime(expectedTTFT)} + ${formatTime(expectedDecodeTime)} = ${formatTime(expectedTotalTime)}`;
  const throughputSub = `(${(safePromptTokens + safeOutputTokens).toLocaleString()} tok) ÷ ${formatTime(expectedTotalTime)}`;
  const prefillPctSub = `${formatTime(expectedTTFT)} ÷ ${formatTime(expectedTotalTime)} × 100 = ${prefillPct.toFixed(1)}%`;
  const decodePctSub = `${formatTime(expectedDecodeTime)} ÷ ${formatTime(expectedTotalTime)} × 100 = ${decodePct.toFixed(1)}%`;
  // Human-reading-speed anchors (issue #86): calibrated comparisons that turn
  // abstract tok/s / latency figures into embodied intuition. Each returns
  // null on degenerate inputs so no bogus comparison is rendered.
  const ttftAnchorText = ttftAnchor(expectedTTFT, totalPrefillTokens);
  const tpotAnchorText = tpotAnchor(tpotMs);
  const walltimeAnchorText = walltimeAnchor(expectedTotalTime, outputTokens);
  const throughputNow = Number.isFinite(expectedTotalTime) && expectedTotalTime > 0
    ? (totalPrefillTokens + outputTokens) / expectedTotalTime
    : NaN;
  const throughputAnchorText = throughputAnchor(throughputNow);
  // Markdown walkthrough export (download + clipboard). Inline <details>
  // viewers (#418) render the exact same payloads so agents/headless contexts
  // without download or clipboard plumbing can still read the full result.
  const [mdCopied, setMdCopied] = useState(false);
  const [mdCopyFailed, setMdCopyFailed] = useState(false);
  // #426: ?series=1 adds the deterministic per-token decode timeline to the
  // JSON export (jittered schedule when ITL jitter is on, constant otherwise),
  // capped at MAX_SERIES_TOKENS so runaway output values stay bounded.
  const seriesRequested = readParamBool('series', false);
  const seriesSchedule = (() => {
    if (!seriesRequested || !Number.isFinite(tpotMs) || safeOutputTokens <= 0) return null;
    if (itlSchedule && itlSchedule.length > 0) return itlSchedule.slice(0, MAX_SERIES_TOKENS);
    const n = Math.min(safeOutputTokens, MAX_SERIES_TOKENS);
    return Array.from({ length: n }, (_, i) => (i + 1) * tpotMs);
  })();
  const buildMarkdown = () => buildSingleTurnMarkdown({
    promptTokens,
    outputTokens,
    prefillSpeed,
    decodeSpeed,
    specEnabled,
    draftTokens,
    acceptance,
    effectiveDecodeSpeed,
    ctxScaleEnabled,
    ctxHalf,
    imagesEnabled,
    imageCount,
    imageResId,
    jitterEnabled,
    jitterPct,
    sloBudgets,
    deepLink: buildDeepLink('single'),
    provenance: lmxProvenanceBlock
  });
  const handleExportMd = () => downloadMarkdown(buildMarkdown(), 'single-turn-simulation.md');
  const buildJson = () => buildSingleTurnJson({
    promptTokens,
    outputTokens,
    prefillSpeed,
    decodeSpeed,
    specEnabled,
    draftTokens,
    acceptance,
    effectiveDecodeSpeed,
    ctxScaleEnabled,
    ctxHalf,
    imagesEnabled,
    imageCount,
    imageResId,
    jitterEnabled,
    jitterPct,
    sloBudgets,
    includeSeries: seriesRequested,
    prefillEndMs: Number.isFinite(expectedTTFT) ? expectedTTFT * 1000 : 0,
    itlScheduleMs: seriesSchedule,
    deepLink: buildDeepLink('single'),
    provenance: lmxProvenanceBlock
  });
  const handleExportJson = () => downloadJson(buildJson(), 'single-turn-simulation.json');
  const handleCopyMd = async () => {
    const ok = await copyMarkdownToClipboard(buildMarkdown());
    // Issue #401: surface failure explicitly — silent no-feedback on a failed
    // copy is how agents lose the report without knowing it.
    setMdCopied(ok);
    setMdCopyFailed(!ok);
    setTimeout(() => { setMdCopied(false); setMdCopyFailed(false); }, 2000);
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
  // Issue #827: completed gets its own tag class — reusing tag-decode made
  // "running" and "done" indistinguishable in CSS.
  const phaseTagClass = phaseTagClassFor(phase);

  // Screen-reader run summary (issue #63): an aria-live region narrating the
  // simulation for users who can't watch the token stream. Progress is bucket
  // -rounded (25% prefill / 10% decode) so the rAF loop produces a handful of
  // announcements per run instead of one per frame.
  const srPrefillBucket = Math.min(4, Math.floor(
    (currentPrefillProgress / Math.max(1, totalPrefillTokens)) * 4
  ));
  const srDecodeBucket = Math.min(10, Math.floor(
    (currentDecodeTokens / Math.max(1, safeOutputTokens)) * 10
  ));
  const srSummary = phase === 'idle'
    ? 'Simulation idle. Set the workload and press Start to run it.'
    : phase === 'prefilling'
      ? `Prefilling: about ${srPrefillBucket * 25} percent of ${formatTokens(totalPrefillTokens)} prompt tokens ingested.`
      : phase === 'decoding'
        ? `Prefill finished in ${formatTime(expectedTTFT)}. Decoding at ${displayDecodeSpeed} tokens per second: about ${srDecodeBucket * 10} percent of ${formatTokens(safeOutputTokens)} output tokens generated.`
        : `Run complete in ${formatTime(expectedTotalTime)}: ${formatTokens(totalPrefillTokens)} prompt tokens prefilled, ${safeOutputTokens.toLocaleString()} tokens decoded.`;

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

  // Issue #73: announce phase transitions and the completion summary through
  // the polite live region. The effect fires only on phase *changes*; metric
  // values are read through a ref so mid-phase re-renders never re-announce.
  // The summary is forced past the throttle — it is the one message an SR
  // user must never miss.
  const liveMetricsRef = useRef({});
  liveMetricsRef.current = {
    prefillTokens: totalPrefillTokens,
    ttftSec: expectedTTFT,
    tpotMs,
    totalSec: expectedTotalTime
  };
  useEffect(() => {
    const m = liveMetricsRef.current;
    if (phase === 'prefilling') {
      announce(buildPrefillAnnouncement(m.prefillTokens));
    } else if (phase === 'decoding') {
      announce(buildDecodeAnnouncement());
    } else if (phase === 'completed') {
      announce(
        buildDoneAnnouncement({ ttftSec: m.ttftSec, tpotMs: m.tpotMs, totalSec: m.totalSec }),
        { force: true }
      );
    }
  }, [phase, announce]);


  return (
    <div className="stack">

      {/* Issue #73: screen-reader progress announcements (visually hidden) */}
      <AriaLiveRegion message={liveMessage} />
      {/* Issue #63: live narration of the animated run for screen readers */}
      {/* #63 run summary text: deliberately NOT an aria-live region (#1010) —
          the throttled AriaLiveRegion above is this view's single announcer;
          a second polite region here re-announced every transition and
          defeated the 5 s throttle. Text stays available to SR browsing. */}
      <div className="visually-hidden">{srSummary}</div>

      {/* Top Parameter Cards */}
      <section className="panel" aria-label={t('singleTurn.paramsPanelAria')}>
        <h2 className="panel-title" style={{ marginBottom: '14px' }} tabIndex={-1} data-panel-heading>
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
            <div className="grid-auto" style={{ '--grid-min': '13.75rem' }}>
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
                  aria-valuetext={`${draftTokens} draft ${draftTokens === 1 ? 'token' : 'tokens'}`}
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
                  aria-valuetext={`${Math.round(acceptance * 100)}% token acceptance`}
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
              <div className="grid-auto" style={{ '--grid-min': '16.25rem', gap: '8px' }}>
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
              <div className="grid-auto" style={{ '--grid-min': '13.75rem' }}>
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
                    aria-valuetext={`±${jitterPct}% timing variance`}
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

        {/* Context-length scaling of decode speed */}
        <div className="panel-inset" style={{ marginBottom: '14px', borderColor: ctxScaleEnabled ? 'var(--decode-border)' : 'var(--border)' }}>
          <div className="field-head" style={{ marginBottom: ctxScaleEnabled ? '10px' : '0' }}>
            <button
              onClick={() => setCtxScaleEnabled(!ctxScaleEnabled)}
              className={`seg${ctxScaleEnabled ? ' active' : ''}`}
              aria-pressed={ctxScaleEnabled}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '4px 12px', cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${ctxScaleEnabled ? 'var(--decode-border)' : 'var(--border)'}`,
                background: ctxScaleEnabled ? 'var(--decode-dim)' : 'var(--bg-inset)',
                color: ctxScaleEnabled ? 'var(--decode)' : 'var(--text-muted)'
              }}
            >
              <Gauge size={14} /> {t('singleTurn.ctxScaling')} {ctxScaleEnabled ? t('singleTurn.specOn') : t('singleTurn.specOff')}
            </button>
            {ctxScaleEnabled && (
              <span className="tag tag-decode">
                {t('singleTurn.ctxEffectiveTag', { speed: fmtEn(displayDecodeSpeed) })}
              </span>
            )}
          </div>
          {ctxScaleEnabled && (
            <>
              <div className="grid-auto" style={{ '--grid-min': '13.75rem' }}>
                <div className="field">
                  <div className="field-head">
                    <span className="field-label">{t('singleTurn.ctxHalfLabel')}</span>
                    <span className="field-value" style={{ color: 'var(--decode)' }}>
                      {formatTokens(ctxHalfSafe)} tok
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="range"
                      min="0"
                      max={HALF_SPEED_CONTEXT_PRESETS.length - 1}
                      step="1"
                      value={ctxPresetIndex}
                      aria-label={t('singleTurn.ctxHalfAria')}
                      aria-valuetext={`${formatTokens(HALF_SPEED_CONTEXT_PRESETS[ctxPresetIndex])} context`}
                      onChange={(e) => setCtxHalf(HALF_SPEED_CONTEXT_PRESETS[Number(e.target.value)])}
                      style={{ flex: 1 }}
                    />
                    {/* #412: number twin accepting exact token depths — snaps
                        to the nearest modeled C½ step instead of guessing. */}
                    <input
                      type="number"
                      min={HALF_SPEED_CONTEXT_PRESETS[0]}
                      max={HALF_SPEED_CONTEXT_PRESETS[HALF_SPEED_CONTEXT_PRESETS.length - 1]}
                      step="1024"
                      value={ctxHalfSafe}
                      aria-label={`${t('singleTurn.ctxHalfAria')} value`}
                      title={`Modeled steps: ${HALF_SPEED_CONTEXT_PRESETS.map(formatTokens).join(', ')} tokens — entered values snap to the nearest step`}
                      onChange={commitHalfContextNumber}
                      style={{ width: '5.5rem' }}
                    />
                    <span className="field-label">tok</span>
                  </div>
                  <div className="field-scale">
                    <span>{formatTokens(HALF_SPEED_CONTEXT_PRESETS[0])}</span>
                    <span>{formatTokens(HALF_SPEED_CONTEXT_PRESETS[HALF_SPEED_CONTEXT_PRESETS.length - 1])}</span>
                  </div>
                </div>
                <div className="field">
                  <div className="field-head">
                    <span className="field-label">{t('singleTurn.ctxChartLabel')}</span>
                    <span className="field-value" style={{ color: 'var(--decode)', fontFamily: 'var(--font-mono)' }}>
                      {Math.round(curveStartSpeed).toLocaleString()} → {Math.round(curveEndSpeed).toLocaleString()} tok/s
                    </span>
                  </div>
                  <p className="hint-text" style={{ margin: 0 }}>
                    {t('singleTurn.ctxProbeReadout', {
                      generated: probeGen.toLocaleString(),
                      cache: (totalPrefillTokens + probeGen).toLocaleString(),
                      speed: Math.round(probeSpeed).toLocaleString(),
                      pct: probePctOfBase.toFixed(0)
                    })}
                  </p>
                </div>
              </div>

              {/* Decay curve with draggable depth marker */}
              <svg
                ref={decaySvgRef}
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                role="img"
                aria-label={t('singleTurn.ctxChartAria')}
                style={{ width: '100%', marginTop: '10px', cursor: 'ew-resize', touchAction: 'none', display: 'block' }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  moveProbeToClientX(e.clientX);
                }}
                onPointerMove={(e) => {
                  if (e.buttons & 1) moveProbeToClientX(e.clientX);
                }}
              >
                {/* plot frame + baseline */}
                <rect x={PAD_L} y={PAD_T} width={innerW} height={innerH} fill="none" stroke="var(--border)" />
                {/* curve area fill + line */}
                <polygon
                  points={`${PAD_L},${yAt(yLo)} ${curvePoints} ${CHART_W - PAD_R},${yAt(yLo)}`}
                  fill="var(--decode)"
                  opacity="0.12"
                />
                <polyline points={curvePoints} fill="none" stroke="var(--decode)" strokeWidth="2" />
                {/* base-speed reference at the left edge */}
                <line x1={PAD_L} y1={yAt(effectiveDecodeSpeed)} x2={CHART_W - PAD_R} y2={yAt(effectiveDecodeSpeed)} stroke="var(--text-subtle)" strokeDasharray="4 4" strokeWidth="1" />
                <text x={PAD_L} y={yAt(effectiveDecodeSpeed) - 5} fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-mono)">
                  base {Math.round(effectiveDecodeSpeed).toLocaleString()} tok/s
                </text>
                {/* live position while decoding */}
                {phase === 'decoding' && (
                  <line
                    x1={xAt(Math.min(currentDecodeTokens, chartMaxGen))} y1={PAD_T}
                    x2={xAt(Math.min(currentDecodeTokens, chartMaxGen))} y2={CHART_H - PAD_B}
                    stroke="var(--prefill)" strokeWidth="1.5" opacity="0.7"
                  />
                )}
                {/* draggable depth probe */}
                <g>
                  <line x1={xAt(probeGen)} y1={PAD_T} x2={xAt(probeGen)} y2={CHART_H - PAD_B} stroke="var(--decode)" strokeWidth="1.5" />
                  <circle cx={xAt(probeGen)} cy={yAt(probeSpeed)} r="5" fill="var(--decode)" stroke="var(--bg-raised)" strokeWidth="2" />
                  <text
                    x={Math.min(xAt(probeGen) + 8, CHART_W - PAD_R - 90)} y={PAD_T + 12}
                    fontSize="11" fill="var(--text-main)" fontFamily="var(--font-mono)" fontWeight="700"
                  >
                    {Math.round(probeSpeed).toLocaleString()} tok/s @ +{probeGen.toLocaleString()}
                  </text>
                </g>
              </svg>
              {/* Curve-to-table alternative (#720): the decay curve above is
                  pure SVG geometry; this sr-only table exposes the same
                  samples as exact token → tok/s values (every 8th sample). */}
              <ChartDataTable
                caption={t('chartTable.decayCurveCaption')}
                rowHeaderLabel={t('chartTable.generatedToken')}
                columns={[{ key: 'tokps', label: t('chartTable.decodeSpeed'), numeric: true }]}
                mode="sr-only"
                rows={curveSamples
                  .filter((_, i) => i % 8 === 0)
                  .map((p) => ({
                    id: `gen-${p.gen}`,
                    label: `+${Math.round(p.gen).toLocaleString()}`,
                    cells: { tokps: `${Math.round(p.tokps).toLocaleString()} tok/s` }
                  }))}
              />
              <input
                type="range"
                min="0"
                max={chartMaxGen}
                step="1"
                value={probeGen}
                aria-label={t('singleTurn.ctxProbeAria')}
                aria-valuetext={`generated token ${probeGen.toLocaleString()}`}
                onChange={(e) => setProbeTokens(Number(e.target.value))}
                style={{ width: '100%' }}
              />

              <p className="hint-text" style={{ marginTop: '8px' }}>
                {t('singleTurn.ctxHint')}
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
              <ImageIcon size={14} /> Attached Images: {imagesEnabled ? `ON · ${imageCount} × ${imageResolution.label}` : 'OFF'}
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
              <div className="grid-auto" style={{ '--grid-min': '13.75rem' }}>
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
                    aria-valuetext={`${imageCount} ${imageCount === 1 ? 'image' : 'images'}`}
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

        <div className="grid-auto" style={{ '--grid-min': '17.5rem' }}>
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
                aria-valuetext={`${promptTokens.toLocaleString()} tokens`}
                onChange={(e) => {
                  setPromptTokens(Number(e.target.value));
                  handleReset();
                }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min={PROMPT_TOKENS_RANGE.min}
                max={PROMPT_TOKENS_RANGE.max}
                step={PROMPT_TOKENS_RANGE.step}
                value={promptTokens}
                aria-label={t('singleTurn.promptValueAria')}
                title={`Valid range ${PROMPT_TOKENS_RANGE.min}–${PROMPT_TOKENS_RANGE.max} tokens; values outside it are clamped`}
                onChange={commitTokenNumber(setPromptTokens, PROMPT_TOKENS_RANGE)}
                style={{ width: '5rem' }}
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
                aria-valuetext={`${outputTokens.toLocaleString()} tokens`}
                onChange={(e) => {
                  setOutputTokens(Number(e.target.value));
                  handleReset();
                }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min={OUTPUT_TOKENS_RANGE.min}
                max={OUTPUT_TOKENS_RANGE.max}
                step={OUTPUT_TOKENS_RANGE.step}
                value={outputTokens}
                aria-label={t('singleTurn.outputValueAria')}
                title={`Valid range ${OUTPUT_TOKENS_RANGE.min}–${OUTPUT_TOKENS_RANGE.max} tokens; values outside it are clamped`}
                onChange={commitTokenNumber(setOutputTokens, OUTPUT_TOKENS_RANGE)}
                style={{ width: '5rem' }}
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
      <section
        className="panel"
        aria-label={t('singleTurn.simStageAria')}
        data-state={phaseToRunState(phase)}
        aria-busy={runStateToBusy(phaseToRunState(phase))}
      >

        {/* Status Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className={`tag ${phaseTagClass}`} data-run-state={phase} style={{ fontSize: '0.72rem', padding: '3px 9px' }}>
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
              aria-label={t('singleTurn.resetTooltip')}
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
              onClick={handleExportJson}
              title="Export this simulation as machine-readable JSON (download)"
              className="btn"
            >
              <FileJson size={15} />
              Export JSON
            </button>

            <button
              onClick={handleCopyMd}
              title="Copy the markdown walkthrough to the clipboard"
              className="btn"
              aria-label="Copy markdown walkthrough to clipboard"
            >
              <Copy size={15} />
              {mdCopied ? 'Copied!' : mdCopyFailed ? 'Copy failed' : 'Copy MD'}
            </button>
          </div>
        </div>

        {/* Inline export payload viewers (#418): the download/clipboard buttons
            are unusable in headless/download-restricted contexts, so the exact
            payloads are also rendered as selectable text. */}
        <details className="panel-inset" style={{ marginBottom: '18px', fontSize: '0.78rem' }}>
          <summary style={{ cursor: 'pointer' }}>View export payload inline (MD / JSON)</summary>
          <div className="grid-auto" style={{ '--grid-min': '22rem', marginTop: '10px' }}>
            <div>
              <div className="field-label" style={{ marginBottom: '4px' }}>Markdown walkthrough</div>
              <pre style={{
                margin: 0, padding: '8px', maxHeight: '18rem', overflow: 'auto',
                background: 'var(--bg-raised)', borderRadius: 'var(--radius-sm)',
                fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'var(--font-mono)', userSelect: 'all'
              }}>{buildMarkdown()}</pre>
            </div>
            <div>
              <div className="field-label" style={{ marginBottom: '4px' }}>JSON export</div>
              <pre style={{
                margin: 0, padding: '8px', maxHeight: '18rem', overflow: 'auto',
                background: 'var(--bg-raised)', borderRadius: 'var(--radius-sm)',
                fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'var(--font-mono)', userSelect: 'all'
              }}>{serializeJson(buildJson())}</pre>
            </div>
          </div>
        </details>

        {/* Phase Split Dual Progress Bars */}
        <div className="grid-auto" style={{ '--grid-min': '18.75rem', marginBottom: '20px' }}>

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
                <Analogy term="prefill" />
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
                <Analogy term="decode" />
              </span>
              <span className="tag tag-decode">
                {displayDecodeSpeed.toLocaleString()} tok/s · {Number.isFinite(tpotMs) ? `${tpotMs.toFixed(1)} ms/tok` : '∞ ms/tok'}
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

        {/* KV Cache Growth Matrices — prefill fills every row at once (compute-bound),
            decode appends one row per token (memory-bound). The asymmetry IS the lesson. */}
        <div className="panel-inset" style={{ marginBottom: '20px' }}>
          <KVCacheSectionHeader label={t('singleTurn.kvSectionLabel')} />
          <div className="grid-auto" style={{ '--grid-min': '17.5rem' }}>
            <KVCacheMatrix
              title={t('singleTurn.kvPrefillTitle')}
              icon={<Zap size={13} />}
              tone="prefill"
              variant="parallel"
              totalTokens={totalPrefillTokens}
              progress={currentPrefillProgress}
              active={phase === 'prefilling'}
              captions={{ caption: t('singleTurn.kvPrefillCaption') }}
            />
            <KVCacheMatrix
              title={t('singleTurn.kvDecodeTitle')}
              icon={<Gauge size={13} />}
              tone="decode"
              variant="append"
              totalTokens={outputTokens}
              progress={currentDecodeTokens}
              active={phase === 'decoding'}
              captions={{ caption: t('singleTurn.kvDecodeCaption') }}
            />
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
                      data-max-bin-count={maxBinCount}
                      style={{
                        position: 'relative',
                        height: '4rem',
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
                          data-bin={i}
                          data-count={b.count}
                          data-from-ms={b.from}
                          data-to-ms={b.to}
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
                    {/* Chart-to-table alternative (#820): every bin's exact
                        count + ms range, sr-only until keyboard focus — the
                        bars' data-tooltip attrs never reach the AX tree. */}
                    <ChartDataTable
                      caption={t('chartTable.itlHistogramCaption')}
                      rowHeaderLabel={t('chartTable.itlBin')}
                      columns={[{ key: 'count', label: t('chartTable.tokenCount'), numeric: true }]}
                      mode="sr-only"
                      rows={itlHistogram.bins.map((b, i) => ({
                        id: `bin-${i}`,
                        label: `${b.from.toFixed(1)}–${b.to.toFixed(1)}`,
                        cells: { count: b.count.toLocaleString() }
                      }))}
                    />
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
            <div className="metric-label">
              {t('singleTurn.metricTtft')}
              <SloBadge result={sloResults.ttft} label={t('slo.shortTtft')} />
            </div>
            <div className="metric-value" style={{ color: 'var(--prefill)' }}>
              <Metric term="ttft" substitution={ttftSub}>
                {formatTime(expectedTTFT)}
              </Metric>
            </div>
            <div className="metric-sub">
              {totalImageTokens > 0
                ? `Prefill ${totalPrefillTokens.toLocaleString()} tok (incl. images)`
                : 'Prompt prefill latency'}
            </div>
            {ttftAnchorText && <div className="metric-anchor">⏱ {ttftAnchorText}</div>}
          </div>

          <div className="metric" style={{ borderLeftColor: 'var(--decode)' }}>
            <div className="metric-label">
              {t('singleTurn.metricTpot')}
              <SloBadge result={sloResults.tpot} label={t('slo.shortTpot')} />
            </div>
            <div className="metric-value" style={{ color: 'var(--decode)' }}>
              <Metric term="tpot" substitution={tpotSub}>
                {Number.isFinite(tpotMs) ? `${tpotMs.toFixed(1)} ms` : '∞ ms'}
              </Metric>
            </div>
            <div className="metric-sub">{t('singleTurn.tokensPerSecSub', { speed: fmtEn(displayDecodeSpeed) })}</div>
            {tpotAnchorText && <div className="metric-anchor">📖 {tpotAnchorText}</div>}
          </div>

          <div className="metric" style={{ borderLeftColor: 'var(--accent)' }}>
            <div className="metric-label">
              {t('singleTurn.metricTotalWalltime')}
              <SloBadge result={sloResults.walltime} label={t('slo.shortWalltime')} />
            </div>
            <div className="metric-value">
              <Metric term="walltime" substitution={walltimeSub}>
                {formatTime(expectedTotalTime)}
              </Metric>
            </div>
            <div className="metric-sub">{t('singleTurn.metricTotalSub')}</div>
            {walltimeAnchorText && <div className="metric-anchor">📖 {walltimeAnchorText}</div>}
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
            <div className="metric-sub">Total tokens ÷ walltime{totalImageTokens > 0 ? ' (incl. vision tokens)' : ''}</div>
            {throughputAnchorText && <div className="metric-anchor">⚡ {throughputAnchorText}</div>}
          </div>

        </div>

        {/* Stacked Walltime Percentage Bar */}
        <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
          <div className="field-head" style={{ marginBottom: '8px' }}>
            <span className="section-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              {t('singleTurn.distributionLabel')}
              {/* Waterfall SLO verdict (issue #64): overall run vs walltime budget */}
              <SloBadge result={sloResults.walltime} label={t('slo.shortWalltime')} />
            </span>
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

          {/* Chart-to-table alternative (#75): the stacked bar's exact phase
              timings, visually hidden until keyboard focus (prefill/decode
              percentages and tooltips already carry the headline numbers). */}
          <ChartDataTable
            caption={t('chartTable.distributionCaption')}
            rowHeaderLabel={t('chartTable.walltimePhase')}
            columns={[
              { key: 'time', label: t('chartTable.time'), numeric: true },
              { key: 'share', label: t('chartTable.shareOfWalltime'), numeric: true }
            ]}
            mode="sr-only"
            rows={[
              {
                id: 'prefill',
                label: t('singleTurn.distributionPrefill'),
                cells: {
                  time: formatTime(expectedTTFT),
                  share: `${prefillPct.toFixed(1)}%`
                }
              },
              {
                id: 'decode',
                label: t('singleTurn.distributionDecode'),
                cells: {
                  time: formatTime(expectedDecodeTime),
                  share: `${decodePct.toFixed(1)}%`
                }
              },
              {
                id: 'total',
                label: t('chartTable.totalWalltimeRow'),
                cells: {
                  time: formatTime(expectedTotalTime),
                  share: '100%'
                }
              }
            ]}
          />
        </div>

      </section>

    </div>
  );
}
