import React, { useState, useEffect, useRef } from 'react';
import { Bot, ToggleLeft, ToggleRight, Play, Pause, CheckCircle, RotateCcw, FileDown, Copy, Zap, Gauge } from 'lucide-react';
import { formatTime, formatTokens } from '../utils/presets';
import { readParamNum, readParamBool, readParam, writeParams } from '../utils/urlState';
import { calculateAgenticTimeline, waterfallGeometry } from '../utils/agenticMath';
import { exportNodeAsPng } from '../utils/exportPng';
import MisconceptionCallout, { isMisconceptionDismissed, dismissMisconception } from './MisconceptionCallout';
import KVCacheMatrix, { KVCacheSectionHeader } from './KVCacheMatrix';
import ConceptCheck from './ConceptCheck';
import Metric from './Metric';
import Analogy from './Analogy';
import SloBadge from './SloBadge';
import { evaluateAgenticSlo, evaluateMetric } from '../utils/slo.js';

import { buildAgenticMarkdown, buildDeepLink, downloadMarkdown, copyMarkdownToClipboard } from '../utils/exportMarkdown';
import { t } from '../i18n/strings';

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
  const [numTurns, setNumTurns] = useState(() => readParamNum('turns', 4));
  const [basePromptTokens, setBasePromptTokens] = useState(() => readParamNum('sprompt', 1500));
  const [toolOutputTokensPerTurn, setToolOutputTokensPerTurn] = useState(() => readParamNum('tool', 800));
  const [decodeTokensPerTurn, setDecodeTokensPerTurn] = useState(() => readParamNum('thought', 250));
  const [enablePrefixCaching, setEnablePrefixCaching] = useState(() => readParamBool('cache', true));

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
  useEffect(() => {
    if (readParam('autoplay') === '1') {
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
  const fmtPct = (r) => Number.isFinite(r.marginPct) ? `${Math.abs(r.marginPct).toFixed(0)}%` : '∞';
  const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
  const turnSloDetail = (triple) => (
    [
      ['TTFT', triple.ttft],
      ['TPOT', triple.tpot],
      ['Walltime', triple.walltime]
    ]
      .filter(([, r]) => r && !r.pass)
      .map(([label, r]) => {
        const val = label === 'TTFT' || label === 'TPOT' ? fmtMs(r.value) : formatTime(r.value);
        return `${label} ${val} vs ${label === 'TTFT' || label === 'TPOT' ? fmtMs(r.budget) : formatTime(r.budget)} (+${fmtPct(r)} over)`;
      })
      .join(' · ')
  );
  // Combined per-row verdict for the waterfall: worst margin across checks.
  const turnSloVerdict = (triple) => {
    const checks = [triple.ttft, triple.tpot, triple.walltime].filter(Boolean);
    if (!checks.length) return null;
    return { pass: checks.every(r => r.pass), marginPct: Math.min(...checks.map(r => r.marginPct)) };
  };
  // Whole-loop walltime vs the walltime budget (header badge).
  const evaluateAgenticSloWalltime = evaluateMetric(totalAgentWalltime, sloBudgets?.walltimeSec);

  // Markdown walkthrough export (download + clipboard)
  const [mdCopied, setMdCopied] = useState(false);
  const buildMarkdown = () => buildAgenticMarkdown({
    numTurns,
    basePromptTokens,
    toolOutputTokensPerTurn,
    decodeTokensPerTurn,
    enablePrefixCaching,
    prefillSpeed,
    decodeSpeed,
    deepLink: buildDeepLink('agentic')
  });
  const handleExportMd = () => downloadMarkdown(buildMarkdown(), 'agentic-loop-simulation.md');
  const handleCopyMd = async () => {
    const ok = await copyMarkdownToClipboard(buildMarkdown());
    if (ok) {
      setMdCopied(true);
      setTimeout(() => setMdCopied(false), 2000);
    }
  };

  // Ref for timer
  const animFrameRef = useRef(null);
  const lastTickRef = useRef(null);
  const simTimeRef = useRef(0);
  const waterfallRef = useRef(null);

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
    setIsPlaying(false);
  };

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

    const tick = (now) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const realDelta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      if (simSpeedMultiplier === 'instant' || !Number.isFinite(totalAgentWalltime) || totalAgentWalltime <= 0) {
        // Instant mode — or a non-finite/zero walltime (e.g. a speed typed as
        // 0, which would otherwise hang the loop on turn 1 forever).
        const last = turnBreakdown[turnBreakdown.length - 1] || { newTokensPrefilled: 0, decodeTokens: 0 };
        setActiveTurn(numTurns);
        setCurrentPhase('completed');
        setPrefillProgress(last.newTokensPrefilled);
        setDecodeProgress(last.decodeTokens);
        setElapsedSim(totalAgentWalltime);
        setIsPlaying(false);
        return;
      }

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
    numTurns,
    basePromptTokens,
    toolOutputTokensPerTurn,
    decodeTokensPerTurn,
    enablePrefixCaching,
    prefillSpeed,
    decodeSpeed,
    totalAgentWalltime
  ]);

  const phaseStatusText = currentPhase === 'prefilling' ? t('agentic.statusPrefilling')
    : currentPhase === 'decoding' ? t('agentic.statusDecoding')
    : currentPhase === 'completed' ? t('agentic.statusCompleted')
    : t('agentic.statusIdle');

  return (
    <div className="stack">

      {/* Top Configuration Card */}
      <section className="panel" aria-label={t('agentic.paramsPanelAria')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
          <h2 className="panel-title" tabIndex={-1} data-panel-heading>
            <Bot size={16} style={{ color: 'var(--agent)' }} />
            <span>{t('agentic.paramsPanelTitle')}</span>
          </h2>

          {/* Prefix Caching Toggle */}
          <button
            data-tour="prefix-caching"
            onClick={handleTogglePrefixCaching}
            className="btn"
            aria-pressed={enablePrefixCaching}
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
                onChange={(e) => { setNumTurns(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={numTurns}
                aria-label={t('agentic.turnsValueAria')}
                onChange={(e) => { setNumTurns(Number(e.target.value)); handleReset(); }}
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
                onChange={(e) => { setBasePromptTokens(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={basePromptTokens}
                aria-label={t('agentic.systemPromptValueAria')}
                onChange={(e) => { setBasePromptTokens(Number(e.target.value)); handleReset(); }}
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
                onChange={(e) => { setToolOutputTokensPerTurn(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={toolOutputTokensPerTurn}
                aria-label={t('agentic.toolOutputValueAria')}
                onChange={(e) => { setToolOutputTokensPerTurn(Number(e.target.value)); handleReset(); }}
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
                onChange={(e) => { setDecodeTokensPerTurn(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={decodeTokensPerTurn}
                aria-label={t('agentic.thoughtValueAria')}
                onChange={(e) => { setDecodeTokensPerTurn(Number(e.target.value)); handleReset(); }}
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
      <section className="panel" aria-label={t('agentic.simStageAria')}>

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
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              {isPlaying ? t('common.pause') : t('agentic.simulateLoop')}
            </button>

            <button
              onClick={handleReset}
              title={t('agentic.resetTooltip')}
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
        {sloEnabled && agenticSlo.failingTurns.length === 0 && (
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
        )}

        {/* Live Side-by-Side Prefill vs Decode Stream */}
        <div className="panel-inset" style={{ marginBottom: '20px' }}>
          <div className="field-head" style={{ marginBottom: '12px', flexWrap: 'wrap' }}>
            <span className="section-label">
              {t('agentic.turnStreamLabel', { turn: activeTurn || '—' })}
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{phaseStatusText}</span>
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
                onClick={() => exportNodeAsPng(waterfallRef.current, 'agentic-waterfall.png')}
                className="btn"
                style={{ padding: '2px 8px', fontSize: '0.68rem' }}
                title={t('agentic.exportPngTooltip')}
              >
                PNG
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

          {/* Scrollable strip on narrow viewports (see .waterfall-rows CSS) */}
          <div className="waterfall-rows">
            {turnBreakdown.map((turnItem, turnIndex) => {
              const isCurrentTurn = activeTurn === turnItem.turn;
              const {
                leftPercent: barLeft,
                widthPercent: barWidth,
                prefillPercent: prefillRatio
              } = waterfallLayout[turnIndex];

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
                      >
                        {prefillRatio > 15 && formatTime(turnItem.prefillTime)}
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
                      >
                        {(100 - prefillRatio) > 15 && formatTime(turnItem.decodeTime)}
                      </div>
                    </div>
                  </div>

                  {/* Turn Walltime Total */}
                  <div style={{ width: '5.375rem', textAlign: 'end', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(turnItem.turnWalltime)}
                    </div>
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

        {/* Detailed Per-Turn Metrics Table */}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('agentic.tableHeaders.turn')}</th>
                <th>{t('agentic.tableHeaders.agentPhase')}</th>
                <th>{t('agentic.tableHeaders.historyContext')}</th>
                <th>{t('agentic.tableHeaders.prefilledTokens')}</th>
                <th>{t('agentic.tableHeaders.prefillTime')}</th>
                <th>{t('agentic.tableHeaders.decodeTime')}</th>
                <th>{t('agentic.tableHeaders.turnWalltime')}</th>
                <th>{t('agentic.tableHeaders.cumulative')}</th>
              </tr>
            </thead>
            <tbody>
              {turnBreakdown.map((t) => (
                <tr
                  key={t.turn}
                  className={activeTurn === t.turn ? 'row-active' : undefined}
                >
                  <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    T{t.turn}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {t.label}
                  </td>
                  <td className="num">
                    {formatTokens(t.totalPromptTokens)} tok
                  </td>
                  <td className="num" style={{ color: 'var(--prefill)', fontWeight: 600 }}>
                    {formatTokens(t.newTokensPrefilled)} tok{t.isCached ? ' ⚡' : ''}
                  </td>
                  <td className="num" style={{ color: 'var(--prefill)' }}>
                    {formatTime(t.prefillTime)}
                  </td>
                  <td className="num" style={{ color: 'var(--decode)' }}>
                    {formatTime(t.decodeTime)}
                  </td>
                  <td className="num" style={{ fontWeight: 700, color: 'var(--agent)' }}>
                    {formatTime(t.turnWalltime)}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {formatTime(t.cumulativeWalltime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </section>

      {/* Concept-check quizzes: prediction-then-reveal wired to live sim state */}
      <ConceptCheck
        tab="agentic"
        context={{
          turns: numTurns,
          cachingOn: enablePrefixCaching,
          walltime: totalAgentWalltime,
          noCacheWalltime: turnBreakdownNoCache,
          savedPct: cachingPercentSaved
        }}
      />

    </div>
  );
}
