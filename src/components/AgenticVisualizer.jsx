import React, { useState, useEffect, useRef } from 'react';
import { Bot, ToggleLeft, ToggleRight, Play, Pause, CheckCircle, RotateCcw, FileDown, Copy, Zap, Gauge, FileJson } from 'lucide-react';
import { formatTime, formatTokens } from '../utils/presets';
import { readParamNum, readParamBool, readParam, consumeAutoplay, writeParams } from '../utils/urlState';
import { shouldCompleteInstantly } from '../utils/simPlayback';
import { calculateAgenticTimeline, waterfallGeometry, waterfallSegmentLabels } from '../utils/agenticMath';
import { phaseToRunState, runStateToBusy } from '../utils/viewState';
import { exportNodeAsPng } from '../utils/exportPng';
import EmbedDialog from './EmbedDialog';
import MisconceptionCallout, { isMisconceptionDismissed, dismissMisconception } from './MisconceptionCallout';
import AriaLiveRegion, { useLiveAnnouncer } from './AriaLiveRegion';
import {
  buildTurnAnnouncement,
  buildAgenticDoneAnnouncement
} from '../utils/liveAnnouncer';
import KVCacheMatrix, { KVCacheSectionHeader } from './KVCacheMatrix';
import ChartDataTable from './ChartDataTable';
import Metric from './Metric';
import Analogy from './Analogy';
import SloBadge from './SloBadge';
import { evaluateAgenticSlo, evaluateMetric, formatSloMs } from '../utils/slo.js';

import usePrefersReducedMotion from '../utils/usePrefersReducedMotion';
import { buildAgenticMarkdown, buildDeepLink, downloadMarkdown, copyMarkdownToClipboard } from '../utils/exportMarkdown';
import { buildAgenticJson, downloadJson, serializeJson } from '../utils/exportJson';
import { waterfallAriaSummary } from '../utils/agenticChartA11y';
import { t } from '../i18n/strings';
import { runStateAttrs } from '../utils/runState';

export default function AgenticVisualizer({
  prefillSpeed,
  decodeSpeed,
  simSpeedMultiplier,
  isPlaying,
  setIsPlaying,
  resetKey,
  sloBudgets
}) {
  // Agent configuration parameters
  const [numTurns, setNumTurns] = useState(() => readParamNum('turns', 4, 1, 200));
  const [basePromptTokens, setBasePromptTokens] = useState(() => readParamNum('sprompt', 1500));
  const [toolOutputTokensPerTurn, setToolOutputTokensPerTurn] = useState(() => readParamNum('tool', 800));
  const [decodeTokensPerTurn, setDecodeTokensPerTurn] = useState(() => readParamNum('thought', 250));
  const [enablePrefixCaching, setEnablePrefixCaching] = useState(() => readParamBool('cache', true));

  // Number twins clamp to the slider range on commit (#409); empty/garbage
  // input keeps the current value (standard controlled-input behaviour).
  const commitClampedNumber = (setter, min, max) => (e) => {
    if (e.target.value === '') return;
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    setter(clampNum(n, min, max));
    handleReset();
  };

  // --- Misconception callout: fires when the user explicitly enables prefix
  // caching — the moment to note that turn 1 still prefills everything. ---
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
  const handleTogglePrefixCaching = () => {
    if (!enablePrefixCaching) fireMisconception('prefix-caching-first-turn');
    setEnablePrefixCaching(!enablePrefixCaching);
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
      turns: numTurns,
      sprompt: basePromptTokens,
      tool: toolOutputTokensPerTurn,
      thought: decodeTokensPerTurn,
      cache: enablePrefixCaching ? '1' : '0'
    });
  }, [numTurns, basePromptTokens, toolOutputTokensPerTurn, decodeTokensPerTurn, enablePrefixCaching]);

  // Simulation execution state
  const [activeTurn, setActiveTurn] = useState(0); // 1-indexed when active, 0 when idle
  const [currentPhase, setCurrentPhase] = useState('idle'); // 'idle' | 'prefilling' | 'decoding' | 'completed'
  const [prefillProgress, setPrefillProgress] = useState(0); // tokens ingested in current turn prefill
  const [decodeProgress, setDecodeProgress] = useState(0); // tokens decoded in current turn
  const [elapsedSim, setElapsedSim] = useState(0); // simulated seconds elapsed across the whole loop

  // Issue #73: throttled screen-reader announcements (polite live region).
  const { message: liveMessage, announce, announcer: liveAnnouncer } = useLiveAnnouncer();

  // Sample token streams for the live prefill/decode visualization
  const SAMPLE_PROMPT_WORDS = [
    "Analyze", "the", "user", "request", "and", "retrieve", "relevant", "context", "from", "the",
    "conversation", "history", "system", "instructions", "tool", "definitions", "knowledge", "base",
    "search", "query", "documents", "embedding", "index", "vector", "database", "results", "ranked",
    "by", "relevance", "score", "including", "metadata", "timestamps", "source", "annotations",
    "task", "constraints", "priorities", "deadline", "budget", "architecture", "design", "requirements",
    "specification", "acceptance", "criteria", "edge", "cases", "fallback", "strategy", "final", "answer"
  ];
  const SAMPLE_DECODE_WORDS = [
    "Understood.", "Let", "me", "query", "the", "vector", "database", "for", "matching", "documents",
    "Processing", "the", "search", "results", "now", "—", "found", "several", "relevant", "sources.",
    "Running", "analysis", "on", "the", "retrieved", "data", "and", "cross-referencing", "with",
    "previous", "tool", "outputs", "from", "this", "session", "to", "ensure", "consistency.", "The",
    "findings", "suggest", "the", "optimal", "approach", "is", "to", "combine", "both", "strategies",
    "and", "validate", "against", "the", "acceptance", "criteria", "before", "finalizing", "the", "report."
  ];

  // Token stream windowing: ~2.5 tokens per displayed word, rendered in a
  // fixed-size window that clears and refills so the visible words track the
  // real token throughput without rendering thousands of DOM nodes.
  const TOKENS_PER_WORD = 2.5;
  const WORD_WINDOW = 150;
  const wordWindowFor = (tokens) => {
    const safeTokens = Math.max(0, tokens || 0);
    const totalWords = Math.floor(safeTokens / TOKENS_PER_WORD);
    const lap = Math.floor(totalWords / WORD_WINDOW);
    const visible = totalWords % WORD_WINDOW;
    return { totalWords, lap, visible };
  };
  const streamWords = (tokens, corpus) => {
    const { totalWords, lap, visible } = wordWindowFor(tokens);
    if (totalWords === 0) return [];
    if (visible === 0) return []; // window just cleared — refilling next tick
    return Array.from({ length: visible }, (_, i) => corpus[(lap * 7 + i) % corpus.length]);
  };

  const turnActions = [
    { tool: 'user_query', label: t('agentic.turnActions.0') },
    { tool: 'database_query', label: t('agentic.turnActions.1') },
    { tool: 'execute_code', label: t('agentic.turnActions.2') },
    { tool: 'web_search', label: t('agentic.turnActions.3') },
    { tool: 'format_response', label: t('agentic.turnActions.4') },
    { tool: 'review_check', label: t('agentic.turnActions.5') }
  ];
  const timelineInputs = {
    numTurns,
    basePromptTokens,
    toolOutputTokensPerTurn,
    decodeTokensPerTurn,
    prefillSpeed,
    decodeSpeed
  };
  const turnBreakdown = calculateAgenticTimeline({
    ...timelineInputs,
    enablePrefixCaching
  }).map((turn, index) => ({
    ...turn,
    ...turnActions[index % turnActions.length]
  }));
  const totalAgentWalltime = turnBreakdown.reduce((acc, t) => acc + t.turnWalltime, 0);
  const waterfallLayout = waterfallGeometry(turnBreakdown);
  const activeTurnItem = activeTurn ? turnBreakdown.find(t => t.turn === activeTurn) : null;

  // KV-cache matrix inputs for the active turn. With prefix caching on, the
  // agent-colored region is history reused from earlier turns — only the
  // delta gets prefilled, which is why turn 2+ TTFTs collapse.
  const kvTurnTotal = activeTurnItem ? activeTurnItem.totalPromptTokens : 0;
  const kvCachedTokens = activeTurnItem && enablePrefixCaching && activeTurnItem.isCached
    ? Math.max(0, activeTurnItem.totalPromptTokens - activeTurnItem.newTokensPrefilled)
    : 0;
  const kvPrefillProgress = kvCachedTokens + (activeTurnItem ? Math.max(0, prefillProgress) : 0);

  // Context growth: KV-cache token count over the loop. During a turn's prefill
  // the context grows from the previous turn's end to this turn's full prompt;
  // during decode it grows by generated tokens. Final context = last turn's
  // totalPromptTokens + its decodeTokens.
  const finalContextTokens = turnBreakdown.length
    ? turnBreakdown[turnBreakdown.length - 1].totalPromptTokens + turnBreakdown[turnBreakdown.length - 1].decodeTokens
    : 0;
  const currentContextTokens = (() => {
    if (!activeTurn || !Number.isFinite(totalAgentWalltime) || totalAgentWalltime <= 0) return 0;
    let accumulated = 0;
    for (const item of turnBreakdown) {
      const turnStart = accumulated;
      const prefillEnd = turnStart + item.prefillTime;
      const turnEnd = turnStart + item.turnWalltime;
      const prevContext = item.totalPromptTokens - (item.isCached ? item.newTokensPrefilled : 0) - item.decodeTokens;
      if (elapsedSim < prefillEnd) {
        const frac = item.prefillTime > 0 ? (elapsedSim - turnStart) / item.prefillTime : 1;
        return Math.round(prevContext + frac * (item.totalPromptTokens - prevContext));
      }
      if (elapsedSim < turnEnd) {
        const frac = item.decodeTime > 0 ? (elapsedSim - prefillEnd) / item.decodeTime : 1;
        return Math.round(item.totalPromptTokens + frac * item.decodeTokens);
      }
      accumulated = turnEnd;
    }
    return finalContextTokens;
  })();
  const contextGrowthPct = finalContextTokens > 0 ? Math.min(100, (currentContextTokens / finalContextTokens) * 100) : 0;

  // Compare walltime if caching was turned off
  const turnBreakdownNoCache = calculateAgenticTimeline({
    ...timelineInputs,
    enablePrefixCaching: false
  }).reduce((total, turn) => total + turn.turnWalltime, 0);

  const cachingTimeSaved = turnBreakdownNoCache - totalAgentWalltime;
  const cachingPercentSaved = Number.isFinite(turnBreakdownNoCache) && turnBreakdownNoCache > 0 ? (cachingTimeSaved / turnBreakdownNoCache) * 100 : 0;

  // SLO check (issue #64): evaluate every turn against the persisted budgets
  // so the UI can flag exactly which turn blows the budget.
  const agenticSlo = evaluateAgenticSlo(turnBreakdown, sloBudgets);
  const sloEnabled = Boolean(sloBudgets?.ttftMs || sloBudgets?.tpotMs || sloBudgets?.walltimeSec);
  const worstSloTurn = agenticSlo.turns.find(t => t.turn === agenticSlo.worstTurn);

  // Human-readable summary of a turn's failing checks, e.g.
  // "TTFT 900 ms vs 500 ms (+80% over) · TPOT ∞".
  // formatSloMs (issue #869): guards Infinity/NaN → '∞' and keeps one
  // decimal below 100 ms so marginal fails aren't hidden by rounding.
  const fmtPct = (r) => Number.isFinite(r.marginPct) ? `${Math.abs(r.marginPct).toFixed(0)}%` : '∞';
  const turnSloDetail = (triple) => (
    [
      ['TTFT', triple.ttft],
      ['TPOT', triple.tpot],
      ['Walltime', triple.walltime]
    ]
      .filter(([, r]) => r && !r.pass)
      .map(([label, r]) => {
        const val = label === 'TTFT' || label === 'TPOT' ? formatSloMs(r.value) : formatTime(r.value);
        return `${label} ${val} vs ${label === 'TTFT' || label === 'TPOT' ? formatSloMs(r.budget) : formatTime(r.budget)} (+${fmtPct(r)} over)`;
      })
      .join(' · ')
  );
  // Combined per-row verdict for the waterfall: worst margin across checks.
  const turnSloVerdict = (triple) => {
    const checks = [triple.ttft, triple.tpot, triple.walltime].filter(Boolean);
    if (!checks.length) return null;
    return { pass: checks.every(r => r.pass), marginPct: Math.min(...checks.map(r => r.marginPct)) };
  };
  // Whole-loop walltime vs the walltime budget (header badge). #682: this is
  // the same verdict evaluateAgenticSlo produces, so the badge and the banner
  // can never disagree about the loop-total scope.
  const evaluateAgenticSloWalltime = agenticSlo.loopTotal;

  // Markdown walkthrough export (download + clipboard). Inline <details>
  // viewers (#423) render the exact same payloads so agents/headless contexts
  // without download or clipboard plumbing can still read the full result.
  const [mdCopied, setMdCopied] = useState(false);
  const [mdCopyFailed, setMdCopyFailed] = useState(false);
  const buildMarkdown = () => buildAgenticMarkdown({
    numTurns,
    basePromptTokens,
    toolOutputTokensPerTurn,
    decodeTokensPerTurn,
    enablePrefixCaching,
    prefillSpeed,
    decodeSpeed,
    sloBudgets,
    deepLink: buildDeepLink('agentic')
  });
  const handleExportMd = () => downloadMarkdown(buildMarkdown(), 'agentic-loop-simulation.md');
  const buildJson = () => buildAgenticJson({
    numTurns,
    basePromptTokens,
    toolOutputTokensPerTurn,
    decodeTokensPerTurn,
    enablePrefixCaching,
    prefillSpeed,
    decodeSpeed,
    sloBudgets,
    deepLink: buildDeepLink('agentic')
  });
  const handleExportJson = () => downloadJson(buildJson(), 'agentic-loop-simulation.json');
  const handleCopyMd = async () => {
    const ok = await copyMarkdownToClipboard(buildMarkdown());
    // Issue #401: surface failure explicitly instead of silent no-feedback.
    setMdCopied(ok);
    setMdCopyFailed(!ok);
    setTimeout(() => { setMdCopied(false); setMdCopyFailed(false); }, 2000);
  };

  // Ref for timer
  const animFrameRef = useRef(null);
  const lastTickRef = useRef(null);
  const simTimeRef = useRef(0);
  const waterfallRef = useRef(null);
  const [embedOpen, setEmbedOpen] = useState(false);
  // Issue #497: PNG export must report failure/fallback, not throw uncaught.
  const [pngExportNote, setPngExportNote] = useState('');

  // Issue #497: exportNodeAsPng falls back to a raw SVG download when
  // rasterization is unavailable (headless/software rendering) and reports
  // what happened; surface that as machine-detectable status text.
  const exportWaterfallPng = async () => {
    if (!waterfallRef.current) return;
    try {
      const outcome = await exportNodeAsPng(waterfallRef.current, 'agentic-waterfall.png');
      setPngExportNote(outcome === 'svg-fallback' ? t('agentic.pngFallbackNote') : '');
    } catch {
      setPngExportNote(t('agentic.exportFailedNote'));
    }
  };

  // Global Reset button (App resetKey) clears ALL sim state
  const resetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      handleReset();
    }
  }, [resetKey]);

  const handleReset = () => {
    setActiveTurn(0);
    setCurrentPhase('idle');
    setPrefillProgress(0);
    setDecodeProgress(0);
    setElapsedSim(0);
    simTimeRef.current = 0;
    liveAnnouncer.reset();
    setIsPlaying(false);
  };

  const prefersReducedMotion = usePrefersReducedMotion();

  // Simulation runner effect
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      lastTickRef.current = null;
      return;
    }

    if (currentPhase === 'idle' || currentPhase === 'completed') {
      setActiveTurn(1);
      setCurrentPhase('prefilling');
      simTimeRef.current = 0;
    }

    // Complete synchronously when no animation frame is needed (#1079):
    // instant mode / reduced-motion / degenerate walltime used to jump from
    // INSIDE the rAF tick, which hidden/background tabs never service —
    // playback hung forever there. Same completion, before any rAF is armed.
    if (
      shouldCompleteInstantly(simSpeedMultiplier, prefersReducedMotion) ||
      !Number.isFinite(totalAgentWalltime) ||
      totalAgentWalltime <= 0
    ) {
      const last = turnBreakdown[turnBreakdown.length - 1] || { newTokensPrefilled: 0, decodeTokens: 0 };
      setActiveTurn(numTurns);
      setCurrentPhase('completed');
      setPrefillProgress(last.newTokensPrefilled);
      setDecodeProgress(last.decodeTokens);
      setElapsedSim(totalAgentWalltime);
      setIsPlaying(false);
      return;
    }

    const tick = (now) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const realDelta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      const simDelta = realDelta * simSpeedMultiplier;
      simTimeRef.current += simDelta;
      const nextTime = simTimeRef.current;
      setElapsedSim(nextTime);

      // Find which turn and phase we are currently in
      let accumulated = 0;
      let foundTurn = numTurns;
      let foundPhase = 'completed';
      let foundTurnStart = 0;
      let foundPrefillEnd = 0;

      for (let t = 0; t < turnBreakdown.length; t++) {
        const item = turnBreakdown[t];
        const turnStart = accumulated;
        const prefillEnd = turnStart + item.prefillTime;
        const turnEnd = turnStart + item.turnWalltime;

        if (nextTime < prefillEnd) {
          foundTurn = item.turn;
          foundPhase = 'prefilling';
          foundTurnStart = turnStart;
          foundPrefillEnd = prefillEnd;
          break;
        } else if (nextTime < turnEnd) {
          foundTurn = item.turn;
          foundPhase = 'decoding';
          foundTurnStart = turnStart;
          foundPrefillEnd = prefillEnd;
          break;
        }
        accumulated = turnEnd;
      }

      if (nextTime >= totalAgentWalltime) {
        const last = turnBreakdown[turnBreakdown.length - 1] || { newTokensPrefilled: 0, decodeTokens: 0 };
        setActiveTurn(numTurns);
        setCurrentPhase('completed');
        setPrefillProgress(last.newTokensPrefilled);
        setDecodeProgress(last.decodeTokens);
        setElapsedSim(totalAgentWalltime);
        setIsPlaying(false);
        return;
      } else {
        setActiveTurn(foundTurn);
        setCurrentPhase(foundPhase);

        // Update live prefill/decode token progress for the current turn
        const item = turnBreakdown.find(t => t.turn === foundTurn);
        if (item) {
          if (foundPhase === 'prefilling') {
            // Guard 0-token phases: 0/0 would make progress NaN
            const frac = item.prefillTime > 0 ? (nextTime - foundTurnStart) / item.prefillTime : 1;
            setPrefillProgress(Math.min(item.newTokensPrefilled, Math.floor(frac * item.newTokensPrefilled)));
            setDecodeProgress(0);
          } else if (foundPhase === 'decoding') {
            const frac = item.decodeTime > 0 ? (nextTime - foundPrefillEnd) / item.decodeTime : 1;
            setPrefillProgress(item.newTokensPrefilled);
            setDecodeProgress(Math.min(item.decodeTokens, Math.floor(frac * item.decodeTokens)));
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [
    isPlaying,
    simSpeedMultiplier,
    prefersReducedMotion,
    numTurns,
    basePromptTokens,
    toolOutputTokensPerTurn,
    decodeTokensPerTurn,
    enablePrefixCaching,
    prefillSpeed,
    decodeSpeed,
    totalAgentWalltime
  ]);

  // Issue #73: announce turn transitions and the loop completion through the
  // polite live region. Long agentic runs change turn/phase many times per
  // second at high sim multipliers — the throttled announcer drops everything
  // inside a 5 s window so the SR queue never floods; only the completion
  // summary forces through.
  const liveMetricsRef = useRef({});
  const firstTurnTtftSec = turnBreakdown[0]?.prefillTime;
  const decodeTurns = turnBreakdown.filter(item => item.decodeTokens > 0);
  const avgTpotMs = decodeTurns.length > 0
    ? decodeTurns.reduce((sum, item) => sum + (1000 * item.decodeTime) / item.decodeTokens, 0) / decodeTurns.length
    : Infinity;
  liveMetricsRef.current = {
    numTurns,
    ttftSec: firstTurnTtftSec,
    tpotMs: avgTpotMs,
    totalSec: totalAgentWalltime
  };
  useEffect(() => {
    if (!activeTurn) return;
    const m = liveMetricsRef.current;
    if (currentPhase === 'prefilling' || currentPhase === 'decoding') {
      announce(buildTurnAnnouncement({ turn: activeTurn, turns: m.numTurns, phase: currentPhase }));
    } else if (currentPhase === 'completed') {
      announce(
        buildAgenticDoneAnnouncement({ turns: m.numTurns, ttftSec: m.ttftSec, tpotMs: m.tpotMs, totalSec: m.totalSec }),
        { force: true }
      );
    }
  }, [activeTurn, currentPhase, announce]);

  const phaseStatusText = currentPhase === 'prefilling' ? t('agentic.statusPrefilling')
    : currentPhase === 'decoding' ? t('agentic.statusDecoding')
    : currentPhase === 'completed' ? t('agentic.statusCompleted')
    : t('agentic.statusIdle');

  // Screen-reader run summary (issue #63): aria-live narration of the agent
  // loop. Announces on turn/phase changes and at 25% wall-time buckets so the
  // rAF loop doesn't flood assistive tech with per-frame updates.
  const srElapsedBucket = Math.min(4, Math.floor(
    (elapsedSim / Math.max(1e-9, totalAgentWalltime)) * 4
  ));
  const srSummary = currentPhase === 'idle'
    ? 'Agent loop idle. Set the number of turns and press Start.'
    : currentPhase === 'prefilling'
      ? `Turn ${activeTurn} of ${numTurns}: prefilling ${formatTokens(basePromptTokens)} prompt tokens${enablePrefixCaching && activeTurn > 1 ? ' (served from the prefix cache)' : ''}. About ${srElapsedBucket * 25} percent of the loop elapsed.`
      : currentPhase === 'decoding'
        ? `Turn ${activeTurn} of ${numTurns}: decoding at about ${decodeSpeed.toLocaleString()} tokens per second. About ${srElapsedBucket * 25} percent of the loop elapsed.`
        : `Agent loop complete in ${formatTime(totalAgentWalltime)} across ${numTurns} turns.`;

  return (
    <div className="stack">

      {/* Issue #73: screen-reader progress announcements (visually hidden) */}
      <AriaLiveRegion message={liveMessage} />
      {/* Issue #63: live narration of the animated run for screen readers */}
      {/* #63 run summary text: deliberately NOT an aria-live region (#1010) —
          the throttled AriaLiveRegion above is this view's single announcer;
          a second polite region here re-announced every turn/bucket transition
          and defeated the 5 s throttle ("queue never floods" invariant).
          Text stays available to SR browsing. */}
      <div className="visually-hidden">{srSummary}</div>

      {/* Top Configuration Card */}
      <section className="panel" aria-label={t('agentic.paramsPanelAria')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
          <h2 className="panel-title" tabIndex={-1} data-panel-heading>
            <Bot size={16} style={{ color: 'var(--agent)' }} />
            <span>{t('agentic.paramsPanelTitle')}</span>
          </h2>

          {/* Prefix Caching Toggle */}
          <button
            onClick={handleTogglePrefixCaching}
            className="btn"
            aria-pressed={enablePrefixCaching}
            data-testid="prefix-caching-toggle"
            style={enablePrefixCaching
              ? { borderColor: 'var(--decode-border)', color: 'var(--decode)', background: 'var(--decode-dim)' }
              : undefined}
          >
            {enablePrefixCaching ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
            <span>
              Prefix caching: <strong>{enablePrefixCaching ? t('agentic.prefixCachingOn') : t('agentic.prefixCachingOff')}</strong>
              <Analogy term="prefixCaching" />
            </span>
          </button>
        </div>

        <div className="grid-auto" style={{ '--grid-min': '15rem' }}>

          {/* Number of Turns */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('agentic.agentTurns')}</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{numTurns} {t('agentic.turnsUnit')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="1"
                max="200"
                step="1"
                value={numTurns}
                aria-label={t('agentic.turnsAria')}
                aria-valuetext={`${numTurns} ${numTurns === 1 ? 'turn' : 'turns'}`}
                onChange={(e) => { setNumTurns(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min="1"
                max="200"
                step="1"
                value={numTurns}
                aria-label={t('agentic.turnsValueAria')}
                title="Valid range 1–200 turns; values outside it are clamped"
                onChange={commitClampedNumber(setNumTurns, 1, 200)}
                style={{ width: '4rem' }}
              />
            </div>
          </div>

          {/* Base System Prompt Tokens */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('agentic.initialSystemPrompt')}</span>
              <span className="field-value" style={{ color: 'var(--prefill)' }}>{formatTokens(basePromptTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="500"
                max="262144"
                step="250"
                value={basePromptTokens}
                aria-label={t('agentic.systemPromptAria')}
                aria-valuetext={`${basePromptTokens.toLocaleString()} tokens`}
                onChange={(e) => { setBasePromptTokens(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min="500"
                max="262144"
                step="250"
                value={basePromptTokens}
                aria-label={t('agentic.systemPromptValueAria')}
                title="Valid range 500–262,144 tokens; values outside it are clamped"
                onChange={commitClampedNumber(setBasePromptTokens, 500, 262144)}
                style={{ width: '5rem' }}
              />
            </div>
          </div>

          {/* Tool Output Tokens per Turn */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('agentic.toolResultPerTurn')}</span>
              <span className="field-value" style={{ color: 'var(--accent)' }}>+{formatTokens(toolOutputTokensPerTurn)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="100"
                max="50000"
                step="100"
                value={toolOutputTokensPerTurn}
                aria-label={t('agentic.toolOutputAria')}
                aria-valuetext={`${toolOutputTokensPerTurn.toLocaleString()} tokens`}
                onChange={(e) => { setToolOutputTokensPerTurn(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min="100"
                max="50000"
                step="100"
                value={toolOutputTokensPerTurn}
                aria-label={t('agentic.toolOutputValueAria')}
                title="Valid range 100–50,000 tokens; values outside it are clamped"
                onChange={commitClampedNumber(setToolOutputTokensPerTurn, 100, 50000)}
                style={{ width: '5rem' }}
              />
            </div>
          </div>

          {/* Decode Tokens per Turn */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('agentic.agentThoughtPerTurn')}</span>
              <span className="field-value" style={{ color: 'var(--decode)' }}>{formatTokens(decodeTokensPerTurn)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="50"
                max="20000"
                step="50"
                value={decodeTokensPerTurn}
                aria-label={t('agentic.thoughtAria')}
                aria-valuetext={`${decodeTokensPerTurn.toLocaleString()} tokens`}
                onChange={(e) => { setDecodeTokensPerTurn(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min="50"
                max="20000"
                step="50"
                value={decodeTokensPerTurn}
                aria-label={t('agentic.thoughtValueAria')}
                title="Valid range 50–20,000 tokens; values outside it are clamped"
                onChange={commitClampedNumber(setDecodeTokensPerTurn, 50, 20000)}
                style={{ width: '5rem' }}
              />
            </div>
          </div>

        </div>
      </section>

      {/* Misconception callout (context-triggered, dismissible) */}
      {activeCallouts.map(id => (
        <MisconceptionCallout
          key={id}
          id={id}
          onDismiss={() => handleDismissMisconception(id)}
        />
      ))}

      {/* Main Agent Loop Simulation Stage */}
      <section
        className="panel"
        aria-label={t('agentic.simStageAria')}
        data-state={phaseToRunState(currentPhase)}
        aria-busy={runStateToBusy(phaseToRunState(currentPhase))}
      >

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="tag tag-agent" style={{ fontSize: '0.72rem', padding: '3px 9px' }}>
              {t('agentic.multiTurnLoop')}
            </span>
            <span className="hint-text" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              Total walltime{' '}
              <Metric
                term="agentWalltime"
                substitution={`${turnBreakdown.length} turns × (prefill + decode per turn) = ${formatTime(totalAgentWalltime)}`}
              >
                <strong style={{ color: 'var(--text-main)', fontSize: '1rem' }}>{formatTime(totalAgentWalltime)}</strong>
              </Metric>
              <SloBadge result={evaluateAgenticSloWalltime} label={t('slo.shortWalltime')} />
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`btn ${isPlaying ? 'btn-warn' : 'btn-accent'}`}
              aria-label={isPlaying ? t('agentic.pauseAria') : t('agentic.simulateAria')}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              {isPlaying ? t('common.pause') : t('agentic.simulateLoop')}
            </button>

            <button
              onClick={handleReset}
              title={t('agentic.resetTooltip')}
              aria-label={t('agentic.resetAria')}
              className="btn"
            >
              <RotateCcw size={15} />
              {t('agentic.resetLoop')}
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

        {/* Inline export payload viewers (#423): the download/clipboard buttons
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

        {/* Prefix Caching Time Savings Banner */}
        {enablePrefixCaching ? (
          <div
            className="panel-inset"
            style={{
              borderColor: 'var(--decode-border)',
              background: 'var(--decode-dim)',
              marginBottom: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap',
              fontSize: '0.82rem',
              color: 'var(--decode)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle size={16} />
              <span>
                <strong>{t('agentic.cachingSavingsPrefix')}</strong> {t('agentic.cachingSavingsBody', {
                  without: formatTime(turnBreakdownNoCache),
                  with: formatTime(totalAgentWalltime)
                })}
              </span>
            </div>
            <span className="tag tag-decode">
              {t('agentic.savedTag', {
                time: formatTime(cachingTimeSaved),
                pct: cachingPercentSaved.toFixed(0)
              })}
            </span>
          </div>
        ) : (
          <div
            className="panel-inset"
            style={{
              borderColor: 'var(--agent-border)',
              background: 'var(--agent-dim)',
              marginBottom: '18px',
              fontSize: '0.82rem',
              color: 'var(--agent)'
            }}
          >
            <strong>{t('agentic.cachingDisabledPrefix')}</strong> {t('agentic.cachingDisabledBody')}
          </div>
        )}

        {/* SLO offender banner (issue #64): name the turn that blows the budget */}
        {sloEnabled && agenticSlo.failingTurns.length > 0 && worstSloTurn && (
          <div
            className="panel-inset"
            role="alert"
            aria-label={t('slo.agenticOffender', { turn: worstSloTurn.turn, detail: turnSloDetail(worstSloTurn) })}
            style={{
              borderColor: 'var(--danger)',
              background: 'rgba(248, 113, 113, 0.08)',
              marginBottom: '18px',
              fontSize: '0.8rem',
              color: 'var(--text-muted)'
            }}
          >
            <strong style={{ color: 'var(--danger)' }}>
              {t('slo.agenticOffender', { turn: agenticSlo.worstTurn, detail: turnSloDetail(worstSloTurn) })}
            </strong>
            {agenticSlo.failingTurns.length > 1 && (
              <span> {t('slo.agenticOffenderSuffix', { turns: agenticSlo.failingTurns.join(', ') })}</span>
            )}
          </div>
        )}
        {/* #682: the all-clear banner consults BOTH scopes — per-turn checks
            AND the whole-loop walltime. A loop whose turns all pass but whose
            total walltime overruns the budget gets a scoped warning instead of
            a false "everything passes". */}
        {sloEnabled && agenticSlo.failingTurns.length === 0 && (() => {
          const loopOver = agenticSlo.loopTotal && !agenticSlo.loopTotal.pass;
          if (!loopOver) {
            return (
              <div
                className="panel-inset"
                style={{
                  borderColor: 'var(--decode-border)',
                  background: 'var(--decode-dim)',
                  marginBottom: '18px',
                  fontSize: '0.8rem',
                  color: 'var(--decode)'
                }}
              >
                {t('slo.agenticAllPass')}
              </div>
            );
          }
          return (
            <div
              className="panel-inset"
              role="alert"
              aria-label={t('slo.agenticTurnsPassLoopOver', {
                value: formatTime(agenticSlo.loopTotal.value),
                budget: formatTime(agenticSlo.loopTotal.budget)
              })}
              style={{
                borderColor: 'var(--danger)',
                background: 'rgba(248, 113, 113, 0.08)',
                marginBottom: '18px',
                fontSize: '0.8rem',
                color: 'var(--text-muted)'
              }}
            >
              <strong style={{ color: 'var(--danger)' }}>
                {t('slo.agenticTurnsPassLoopOver', {
                  value: formatTime(agenticSlo.loopTotal.value),
                  budget: formatTime(agenticSlo.loopTotal.budget)
                })}
              </strong>
            </div>
          );
        })()}

        {/* Live Side-by-Side Prefill vs Decode Stream */}
        <div className="panel-inset" style={{ marginBottom: '20px' }}>
          <div className="field-head" style={{ marginBottom: '12px', flexWrap: 'wrap' }}>
            <span className="section-label">
              {t('agentic.turnStreamLabel', { turn: activeTurn || '—' })}
            </span>
            <span data-run-state={currentPhase} style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{phaseStatusText}</span>
          </div>

          {/* Overall agent loop progress: elapsed / total (rAF-driven — no transition) */}
          <div style={{ marginBottom: '14px' }}>
            <div className="field-head" style={{ marginBottom: '5px' }}>
              <span className="field-label">{t('agentic.overallProgress')}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 700, color: 'var(--agent)', fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(elapsedSim)} / {formatTime(totalAgentWalltime)}
              </span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${totalAgentWalltime > 0 ? Math.min(100, (elapsedSim / totalAgentWalltime) * 100) : 0}%`,
                  background: 'var(--agent)'
                }}
              />
            </div>
          </div>

          {/* KV cache growth for this turn — the cached prefix stays shaded
              (reused) while only the delta rows are written during prefill. */}
          <div style={{ marginBottom: '14px' }}>
            <KVCacheSectionHeader label={t('agentic.kvSectionLabel', { turn: activeTurn || '—' })} />
            <div className="grid-auto" style={{ '--grid-min': '17.5rem' }}>
              <KVCacheMatrix
                title={t('agentic.kvPrefillTitle')}
                icon={<Zap size={13} />}
                tone={kvCachedTokens > 0 ? 'agent' : 'prefill'}
                variant="parallel"
                totalTokens={kvTurnTotal}
                progress={kvPrefillProgress}
                cachedTokens={kvCachedTokens}
                active={currentPhase === 'prefilling'}
                captions={{
                  legend: kvCachedTokens > 0 ? t('agentic.kvDeltaLegend') : undefined,
                  cachedLegend: kvCachedTokens > 0 ? t('agentic.kvCachedLegend') : undefined,
                  caption: enablePrefixCaching ? t('agentic.kvCachedCaption') : t('agentic.kvNoCacheCaption')
                }}
              />
              <KVCacheMatrix
                title={t('agentic.kvDecodeTitle')}
                icon={<Gauge size={13} />}
                tone="decode"
                variant="append"
                totalTokens={activeTurnItem ? activeTurnItem.decodeTokens : 0}
                progress={activeTurnItem ? decodeProgress : 0}
                active={currentPhase === 'decoding'}
                captions={{ caption: t('agentic.kvDecodeCaption') }}
              />
            </div>
          </div>

          <div className="grid-auto" style={{ '--grid-min': '17.5rem' }}>
            {/* Prefill Panel */}
            <div
              className="panel-inset"
              style={{
                borderColor: currentPhase === 'prefilling' ? 'var(--prefill-border)' : 'var(--border)',
                background: currentPhase === 'prefilling' ? 'var(--prefill-dim)' : 'var(--bg-inset)',
                transition: 'background 0.2s ease, border-color 0.2s ease'
              }}
            >
              <div className="field-head" style={{ marginBottom: '6px' }}>
                <span className="panel-title" style={{ color: 'var(--prefill)', fontSize: '0.74rem' }}>
                  {t('agentic.prefillPanelTitle')}
                </span>
                <span className="tag tag-prefill">
                  {formatTokens(activeTurnItem ? activeTurnItem.newTokensPrefilled : 0)} tok
                </span>
              </div>

              {/* Progress bar: processed / assigned tokens (rAF-driven — no transition) */}
              <div className="progress-track" style={{ margin: '8px 0' }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${activeTurnItem && activeTurnItem.newTokensPrefilled > 0 ? Math.min(100, (prefillProgress / activeTurnItem.newTokensPrefilled) * 100) : 0}%`,
                    background: 'var(--prefill)'
                  }}
                />
              </div>

              {/* Token stream — windowed to match real token count */}
              <div className="stream-box" style={{ height: '9.375rem', fontSize: '0.8rem' }}>
                {(() => {
                  const words = streamWords(prefillProgress, SAMPLE_PROMPT_WORDS);
                  const { totalWords, lap, visible } = wordWindowFor(prefillProgress);
                  if (!activeTurnItem || totalWords === 0) {
                    return (
                      <span className="stream-placeholder">
                        {currentPhase === 'prefilling' ? t('agentic.placeholderPrefilling') : t('agentic.placeholderWaitingPrefill')}
                      </span>
                    );
                  }
                  if (visible === 0) {
                    return (
                      <span className="stream-placeholder">
                        {t('agentic.windowDonePrefill', {
                          lap,
                          tokens: formatTokens(totalWords * TOKENS_PER_WORD)
                        })}
                      </span>
                    );
                  }
                  return words.map((word, i) => (
                    <span
                      key={`${lap}-${i}`}
                      style={{
                        background: i === words.length - 1 ? 'var(--prefill-dim)' : 'transparent',
                        color: i === words.length - 1 ? 'var(--prefill)' : 'var(--text-main)',
                        borderRadius: '3px',
                        padding: '0 2px'
                      }}
                    >
                      {word}
                    </span>
                  ));
                })()}
              </div>

              <div className="field-head" style={{ marginTop: '8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <span>{t('agentic.ingested')} <strong style={{ color: 'var(--text-main)' }}>{prefillProgress.toLocaleString()}</strong> / {activeTurnItem ? activeTurnItem.newTokensPrefilled.toLocaleString() : '0'}</span>
                <span>{t('agentic.tokPerWord', { n: TOKENS_PER_WORD })}</span>
              </div>
            </div>

            {/* Decode Panel */}
            <div
              className="panel-inset"
              style={{
                borderColor: currentPhase === 'decoding' ? 'var(--decode-border)' : 'var(--border)',
                background: currentPhase === 'decoding' ? 'var(--decode-dim)' : 'var(--bg-inset)',
                transition: 'background 0.2s ease, border-color 0.2s ease'
              }}
            >
              <div className="field-head" style={{ marginBottom: '6px' }}>
                <span className="panel-title" style={{ color: 'var(--decode)', fontSize: '0.74rem' }}>
                  {t('agentic.decodePanelTitle')}
                </span>
                <span className="tag tag-decode">
                  {formatTokens(activeTurnItem ? activeTurnItem.decodeTokens : 0)} tok
                </span>
              </div>

              {/* Progress bar: processed / assigned tokens (rAF-driven — no transition) */}
              <div className="progress-track" style={{ margin: '8px 0' }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${activeTurnItem && activeTurnItem.decodeTokens > 0 ? Math.min(100, (decodeProgress / activeTurnItem.decodeTokens) * 100) : 0}%`,
                    background: 'var(--decode)'
                  }}
                />
              </div>

              {/* Token stream — windowed to match real token count */}
              <div className="stream-box" style={{ height: '9.375rem', fontSize: '0.8rem' }}>
                {(() => {
                  const words = streamWords(decodeProgress, SAMPLE_DECODE_WORDS);
                  const { totalWords, lap, visible } = wordWindowFor(decodeProgress);
                  if (!activeTurnItem || totalWords === 0) {
                    return (
                      <span className="stream-placeholder">
                        {currentPhase === 'decoding' ? t('agentic.placeholderDecoding') : t('agentic.placeholderWaitingDecode')}
                      </span>
                    );
                  }
                  if (visible === 0) {
                    return (
                      <span className="stream-placeholder">
                        {t('agentic.windowDoneDecode', {
                          lap,
                          tokens: formatTokens(totalWords * TOKENS_PER_WORD)
                        })}
                      </span>
                    );
                  }
                  return words.map((word, i) => (
                    <span
                      key={`${lap}-${i}`}
                      style={{
                        background: i === words.length - 1 ? 'var(--decode-dim)' : 'transparent',
                        color: i === words.length - 1 ? 'var(--decode)' : 'var(--text-main)',
                        borderRadius: '3px',
                        padding: '0 2px'
                      }}
                    >
                      {word}
                    </span>
                  ));
                })()}
              </div>

              <div className="field-head" style={{ marginTop: '8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <span>{t('agentic.generated')} <strong style={{ color: 'var(--text-main)' }}>{decodeProgress.toLocaleString()}</strong> / {activeTurnItem ? activeTurnItem.decodeTokens.toLocaleString() : '0'}</span>
                <span>{t('agentic.tokPerWord', { n: TOKENS_PER_WORD })}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Gantt / Waterfall Timeline Chart */}
        <div className="panel-inset" style={{ marginBottom: '20px' }} ref={waterfallRef}>
          <div className="field-head" style={{ marginBottom: '14px', flexWrap: 'wrap' }}>
            <span className="section-label">{t('agentic.waterfallLabel')}</span>
            <div style={{ display: 'flex', gap: '14px', fontSize: '0.72rem', fontWeight: 600, alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--prefill)' }}>
                <span style={{ width: '10px', height: '10px', background: 'var(--prefill)', borderRadius: '2px' }} /> {t('agentic.legendPrefill')}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--decode)' }}>
                <span style={{ width: '10px', height: '10px', background: 'var(--decode)', borderRadius: '2px' }} /> {t('agentic.legendDecode')}
              </span>
              <button
                onClick={exportWaterfallPng}
                className="btn"
                style={{ padding: '2px 8px', fontSize: '0.68rem' }}
                title={t('agentic.exportPngTooltip')}
              >
                PNG
              </button>
              {pngExportNote && (
                <span role="status" aria-live="polite" style={{ color: 'var(--agent)', fontWeight: 500 }}>
                  {pngExportNote}
                </span>
              )}
              <button
                onClick={() => setEmbedOpen(true)}
                className="btn"
                style={{ padding: '2px 8px', fontSize: '0.68rem' }}
                title={t('embed.buttonTooltip')}
              >
                {t('embed.button')}
              </button>
            </div>
          </div>

          {/* Live KV-cache context growth bar */}
          <div style={{ marginBottom: '14px' }}>
            <div className="field-head" style={{ marginBottom: '4px', fontSize: '0.74rem' }}>
              <span className="section-label" style={{ fontSize: '0.7rem' }}>
                {t('agentic.contextGrowth')}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--agent)', fontVariantNumeric: 'tabular-nums' }}>
                {currentContextTokens.toLocaleString()} / {finalContextTokens.toLocaleString()} tok
                {' '}· {t('agentic.accumulatedSuffix', { thousands: (currentContextTokens / 1000).toFixed(1) })}
              </span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${contextGrowthPct}%`,
                  background: 'linear-gradient(90deg, var(--agent), var(--decode))'
                }}
              />
            </div>
          </div>

          {/* Scrollable strip on narrow viewports (see .waterfall-rows CSS).
              role="img" + summary label (#421): the per-turn values are only
              encoded as positioned divs/tooltips, so the chart carries its
              own readable summary without needing the table toggle. */}
          <div
            className="waterfall-rows"
            role="img"
            aria-label={waterfallAriaSummary(turnBreakdown, totalAgentWalltime)}
          >
            {turnBreakdown.map((turnItem, turnIndex) => {
              const isCurrentTurn = activeTurn === turnItem.turn;
              const {
                leftPercent: barLeft,
                widthPercent: barWidth,
                prefillPercent: prefillRatio
              } = waterfallLayout[turnIndex];
              // Issue #495: segments too narrow for an inline label must still
              // expose their value as visible text in the row, not tooltip-only.
              const labels = waterfallSegmentLabels(prefillRatio);

              return (
                <div
                  key={turnItem.turn}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '7px 10px',
                    borderRadius: 'var(--radius-md)',
                    background: isCurrentTurn ? 'var(--agent-dim)' : 'var(--bg-panel)',
                    border: `1px solid ${isCurrentTurn ? 'var(--agent-border)' : 'var(--border)'}`,
                    transition: 'background 0.15s ease, border-color 0.15s ease'
                  }}
                >
                  <div style={{ width: '4.75rem', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                      T{turnItem.turn}
                    </div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                      {formatTokens(turnItem.totalPromptTokens)} tok
                    </div>
                  </div>

                  {/* Waterfall Bar — rows use cumulative left offsets */}
                  <div style={{ flex: 1, height: '22px', background: 'var(--bg-raised)', borderRadius: 'var(--radius-sm)', position: 'relative', overflow: 'hidden', minWidth: 0 }}>
                    <div
                      style={{
                        width: `${barWidth}%`,
                        left: `${barLeft}%`,
                        position: 'absolute',
                        display: 'flex',
                        height: '100%'
                      }}
                    >
                      {/* Prefill segment */}
                      <div
                        style={{
                          width: `${prefillRatio}%`,
                          background: turnItem.isCached ? 'var(--prefill)' : '#1D6FA8',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--accent-ink)',
                          fontSize: '0.64rem',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)'
                        }}
                        data-tooltip={t('agentic.segmentPrefillTooltip', {
                          turn: turnItem.turn,
                          time: formatTime(turnItem.prefillTime),
                          tokens: turnItem.newTokensPrefilled
                        })}
                        title={t('agentic.segmentPrefillTooltip', {
                          turn: turnItem.turn,
                          time: formatTime(turnItem.prefillTime),
                          tokens: turnItem.newTokensPrefilled
                        })}
                      >
                        {labels.prefillInline && formatTime(turnItem.prefillTime)}
                      </div>

                      {/* Decode segment */}
                      <div
                        style={{
                          width: `${100 - prefillRatio}%`,
                          background: 'var(--decode)',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--accent-ink)',
                          fontSize: '0.64rem',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)'
                        }}
                        data-tooltip={t('agentic.segmentDecodeTooltip', {
                          turn: turnItem.turn,
                          time: formatTime(turnItem.decodeTime),
                          tokens: turnItem.decodeTokens
                        })}
                        title={t('agentic.segmentDecodeTooltip', {
                          turn: turnItem.turn,
                          time: formatTime(turnItem.decodeTime),
                          tokens: turnItem.decodeTokens
                        })}
                      >
                        {labels.decodeInline && formatTime(turnItem.decodeTime)}
                      </div>
                    </div>
                  </div>

                  {/* Turn Walltime Total */}
                  <div style={{ width: '5.375rem', textAlign: 'end', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(turnItem.turnWalltime)}
                    </div>
                    {/* Issue #495: segments whose inline label was suppressed
                        (segment < 15% of the bar) keep their value visible as
                        text here instead of disappearing into a tooltip. */}
                    {labels.needsTextFallback && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                        {labels.prefillInline ? '' : `${formatTime(turnItem.prefillTime)} + `}
                        {labels.decodeInline ? '' : formatTime(turnItem.decodeTime)}
                      </div>
                    )}
                    <div style={{ fontSize: '0.64rem', color: turnItem.isCached ? 'var(--prefill)' : 'var(--text-subtle)', marginBottom: sloEnabled ? '3px' : undefined }}>
                      {turnItem.isCached ? t('agentic.cachedLabel') : t('agentic.fullIngestLabel')}
                    </div>
                    {/* Per-turn SLO verdict (issue #64): worst margin across this turn's checks */}
                    {sloEnabled && (
                      <SloBadge
                        result={turnSloVerdict(agenticSlo.turns[turnIndex] || {})}
                        label={`T${turnItem.turn}`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detailed Per-Turn Metrics Table — chart-to-table alternative (#75):
            the waterfall's exact values behind a disclosure toggle, with
            proper <caption>/<th scope> semantics for assistive tech. */}
        <ChartDataTable
          caption={t('chartTable.ganttCaption')}
          rowHeaderLabel={t('chartTable.turn')}
          columns={[
            { key: 'phase', label: t('chartTable.phase') },
            { key: 'historyContext', label: t('chartTable.historyContext'), numeric: true },
            { key: 'prefilledTokens', label: t('chartTable.prefilledTokens'), numeric: true },
            { key: 'prefillTime', label: t('chartTable.prefillTime'), numeric: true },
            { key: 'decodeTime', label: t('chartTable.decodeTime'), numeric: true },
            { key: 'turnWalltime', label: t('chartTable.turnWalltime'), numeric: true },
            { key: 'cumulative', label: t('chartTable.cumulative'), numeric: true }
          ]}
          rows={turnBreakdown.map((turnItem) => ({
            id: turnItem.turn,
            label: `T${turnItem.turn}`,
            cells: {
              phase: turnItem.label,
              historyContext: `${formatTokens(turnItem.totalPromptTokens)} tok`,
              prefilledTokens: `${formatTokens(turnItem.newTokensPrefilled)} tok${turnItem.isCached ? ' ⚡' : ''}`,
              prefillTime: formatTime(turnItem.prefillTime),
              decodeTime: formatTime(turnItem.decodeTime),
              turnWalltime: formatTime(turnItem.turnWalltime),
              cumulative: formatTime(turnItem.cumulativeWalltime)
            }
          }))}
          mode="disclosure"
        />

      </section>

      <EmbedDialog
        open={embedOpen}
        onClose={() => setEmbedOpen(false)}
        getNode={() => waterfallRef.current}
        title={t('agentic.waterfallLabel')}
        sourceUrl={typeof window !== 'undefined' ? window.location.href : ''}
      />
    </div>
  );
}
