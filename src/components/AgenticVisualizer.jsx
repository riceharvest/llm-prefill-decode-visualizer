import React, { useState, useEffect, useRef } from 'react';
import { Bot, ToggleLeft, ToggleRight, Play, Pause, CheckCircle, RotateCcw, FileDown, Copy } from 'lucide-react';
import { formatTime, formatTokens } from '../utils/presets';
import { readParamNum, readParamBool, readParam, writeParams } from '../utils/urlState';
import { calculateAgenticTimeline, waterfallGeometry } from '../utils/agenticMath';
import { exportNodeAsPng } from '../utils/exportPng';
import MisconceptionCallout, { isMisconceptionDismissed, dismissMisconception } from './MisconceptionCallout';
import Metric from './Metric';

import { buildAgenticMarkdown, buildDeepLink, downloadMarkdown, copyMarkdownToClipboard } from '../utils/exportMarkdown';

export default function AgenticVisualizer({
  prefillSpeed,
  decodeSpeed,
  simSpeedMultiplier,
  isPlaying,
  setIsPlaying,
  resetKey
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
      const t = setTimeout(() => setIsPlaying(true), 250);
      return () => clearTimeout(t);
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
    { tool: 'user_query', label: 'User Task & Agent Plan Generation' },
    { tool: 'database_query', label: 'Tool Call #1: Query Vector DB / RAG' },
    { tool: 'execute_code', label: 'Tool Call #2: Run Data Analysis Code' },
    { tool: 'web_search', label: 'Tool Call #3: Fetch Web Documentation' },
    { tool: 'format_response', label: 'Tool Call #4: Structure Final Report' },
    { tool: 'review_check', label: 'Tool Call #5: Verification & Double-Check' }
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

  const phaseStatusText = currentPhase === 'prefilling' ? 'Prefilling — ingesting prompt tokens'
    : currentPhase === 'decoding' ? 'Decoding — generating tokens'
    : currentPhase === 'completed' ? 'Loop complete'
    : 'Run the simulation to see both phases side by side';

  return (
    <div className="stack">

      {/* Top Configuration Card */}
      <section className="panel" aria-label="Agentic loop parameters">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
          <h2 className="panel-title">
            <Bot size={16} style={{ color: 'var(--agent)' }} />
            <span>Agentic Tool-Loop Parameters</span>
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
            <span>Prefix caching: <strong>{enablePrefixCaching ? 'ON (KV reuse)' : 'OFF (full re-prefill)'}</strong></span>
          </button>
        </div>

        <div className="grid-auto" style={{ '--grid-min': '240px' }}>

          {/* Number of Turns */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Agent Turns</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{numTurns} turns</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="1"
                max="200"
                step="1"
                value={numTurns}
                aria-label="Number of agent turns"
                onChange={(e) => { setNumTurns(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={numTurns}
                aria-label="Number of agent turns value"
                onChange={(e) => { setNumTurns(Number(e.target.value)); handleReset(); }}
                style={{ width: '64px' }}
              />
            </div>
          </div>

          {/* Base System Prompt Tokens */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Initial System Prompt</span>
              <span className="field-value" style={{ color: 'var(--prefill)' }}>{formatTokens(basePromptTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="500"
                max="262144"
                step="250"
                value={basePromptTokens}
                aria-label="Initial system prompt tokens"
                onChange={(e) => { setBasePromptTokens(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={basePromptTokens}
                aria-label="Initial system prompt tokens value"
                onChange={(e) => { setBasePromptTokens(Number(e.target.value)); handleReset(); }}
                style={{ width: '80px' }}
              />
            </div>
          </div>

          {/* Tool Output Tokens per Turn */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Tool Result / Turn</span>
              <span className="field-value" style={{ color: 'var(--accent)' }}>+{formatTokens(toolOutputTokensPerTurn)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="100"
                max="50000"
                step="100"
                value={toolOutputTokensPerTurn}
                aria-label="Tool output tokens per turn"
                onChange={(e) => { setToolOutputTokensPerTurn(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={toolOutputTokensPerTurn}
                aria-label="Tool output tokens per turn value"
                onChange={(e) => { setToolOutputTokensPerTurn(Number(e.target.value)); handleReset(); }}
                style={{ width: '80px' }}
              />
            </div>
          </div>

          {/* Decode Tokens per Turn */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Agent Thought / Turn</span>
              <span className="field-value" style={{ color: 'var(--decode)' }}>{formatTokens(decodeTokensPerTurn)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="50"
                max="20000"
                step="50"
                value={decodeTokensPerTurn}
                aria-label="Decode tokens per turn"
                onChange={(e) => { setDecodeTokensPerTurn(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={decodeTokensPerTurn}
                aria-label="Decode tokens per turn value"
                onChange={(e) => { setDecodeTokensPerTurn(Number(e.target.value)); handleReset(); }}
                style={{ width: '80px' }}
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
      <section className="panel" aria-label="Agent loop simulation">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="tag tag-agent" style={{ fontSize: '0.72rem', padding: '3px 9px' }}>
              MULTI-TURN LOOP
            </span>
            <span className="hint-text" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              Total walltime{' '}
              <Metric
                term="agentWalltime"
                substitution={`${turnBreakdown.length} turns × (prefill + decode per turn) = ${formatTime(totalAgentWalltime)}`}
              >
                <strong style={{ color: 'var(--text-main)', fontSize: '1rem' }}>{formatTime(totalAgentWalltime)}</strong>
              </Metric>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`btn ${isPlaying ? 'btn-warn' : 'btn-accent'}`}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              {isPlaying ? 'Pause' : 'Simulate Agent Loop'}
            </button>

            <button
              onClick={handleReset}
              title="Reset turn state (active turn, phase, token progress)"
              className="btn"
            >
              <RotateCcw size={15} />
              Reset Loop
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
                <strong>Prefix caching savings:</strong> walltime reduced from {formatTime(turnBreakdownNoCache)} to {formatTime(totalAgentWalltime)}
              </span>
            </div>
            <span className="tag tag-decode">
              saved {formatTime(cachingTimeSaved)} ({cachingPercentSaved.toFixed(0)}%)
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
            <strong>Prefix caching disabled:</strong> every turn re-prefills the entire accumulated context history. Turn walltimes grow as history expands.
          </div>
        )}

        {/* Live Side-by-Side Prefill vs Decode Stream */}
        <div className="panel-inset" style={{ marginBottom: '20px' }}>
          <div className="field-head" style={{ marginBottom: '12px', flexWrap: 'wrap' }}>
            <span className="section-label">
              Turn {activeTurn || '—'} stream · prefill ingestion vs decode generation
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{phaseStatusText}</span>
          </div>

          {/* Overall agent loop progress: elapsed / total (rAF-driven — no transition) */}
          <div style={{ marginBottom: '14px' }}>
            <div className="field-head" style={{ marginBottom: '5px' }}>
              <span className="field-label">Overall loop progress</span>
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

          <div className="grid-auto" style={{ '--grid-min': '280px' }}>
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
                  Prefill · prompt ingestion
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
              <div className="stream-box" style={{ height: '150px', fontSize: '0.8rem' }}>
                {(() => {
                  const words = streamWords(prefillProgress, SAMPLE_PROMPT_WORDS);
                  const { totalWords, lap, visible } = wordWindowFor(prefillProgress);
                  if (!activeTurnItem || totalWords === 0) {
                    return (
                      <span className="stream-placeholder">
                        {currentPhase === 'prefilling' ? 'Ingesting prompt context…' : 'Waiting for prefill phase…'}
                      </span>
                    );
                  }
                  if (visible === 0) {
                    return (
                      <span className="stream-placeholder">
                        Window {lap} complete — {formatTokens(totalWords * TOKENS_PER_WORD)} tokens ingested, clearing & continuing…
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
                <span>Ingested <strong style={{ color: 'var(--text-main)' }}>{prefillProgress.toLocaleString()}</strong> / {activeTurnItem ? activeTurnItem.newTokensPrefilled.toLocaleString() : '0'}</span>
                <span>≈{TOKENS_PER_WORD} tok/word</span>
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
                  Decode · token generation
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
              <div className="stream-box" style={{ height: '150px', fontSize: '0.8rem' }}>
                {(() => {
                  const words = streamWords(decodeProgress, SAMPLE_DECODE_WORDS);
                  const { totalWords, lap, visible } = wordWindowFor(decodeProgress);
                  if (!activeTurnItem || totalWords === 0) {
                    return (
                      <span className="stream-placeholder">
                        {currentPhase === 'decoding' ? 'Generating tokens…' : 'Waiting for decode phase…'}
                      </span>
                    );
                  }
                  if (visible === 0) {
                    return (
                      <span className="stream-placeholder">
                        Window {lap} complete — {formatTokens(totalWords * TOKENS_PER_WORD)} tokens generated, clearing & continuing…
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
                <span>Generated <strong style={{ color: 'var(--text-main)' }}>{decodeProgress.toLocaleString()}</strong> / {activeTurnItem ? activeTurnItem.decodeTokens.toLocaleString() : '0'}</span>
                <span>≈{TOKENS_PER_WORD} tok/word</span>
              </div>
            </div>
          </div>
        </div>

        {/* Gantt / Waterfall Timeline Chart */}
        <div className="panel-inset" style={{ marginBottom: '20px' }} ref={waterfallRef}>
          <div className="field-head" style={{ marginBottom: '14px', flexWrap: 'wrap' }}>
            <span className="section-label">Turn-by-turn walltime waterfall</span>
            <div style={{ display: 'flex', gap: '14px', fontSize: '0.72rem', fontWeight: 600, alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--prefill)' }}>
                <span style={{ width: '10px', height: '10px', background: 'var(--prefill)', borderRadius: '2px' }} /> Prefill
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--decode)' }}>
                <span style={{ width: '10px', height: '10px', background: 'var(--decode)', borderRadius: '2px' }} /> Decode
              </span>
              <button
                onClick={() => exportNodeAsPng(waterfallRef.current, 'agentic-waterfall.png')}
                className="btn"
                style={{ padding: '2px 8px', fontSize: '0.68rem' }}
                title="Export this chart as PNG"
              >
                PNG
              </button>
            </div>
          </div>

          {/* Live KV-cache context growth bar */}
          <div style={{ marginBottom: '14px' }}>
            <div className="field-head" style={{ marginBottom: '4px', fontSize: '0.74rem' }}>
              <span className="section-label" style={{ fontSize: '0.7rem' }}>
                Context (KV cache) growth
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--agent)', fontVariantNumeric: 'tabular-nums' }}>
                {currentContextTokens.toLocaleString()} / {finalContextTokens.toLocaleString()} tok
                {' '}· {(currentContextTokens / 1000).toFixed(1)}k accumulated
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                  <div style={{ width: '76px', flexShrink: 0 }}>
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
                        title={`Turn ${turnItem.turn} Prefill: ${formatTime(turnItem.prefillTime)} (${turnItem.newTokensPrefilled} tok)`}
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
                        title={`Turn ${turnItem.turn} Decode: ${formatTime(turnItem.decodeTime)} (${turnItem.decodeTokens} tok)`}
                      >
                        {(100 - prefillRatio) > 15 && formatTime(turnItem.decodeTime)}
                      </div>
                    </div>
                  </div>

                  {/* Turn Walltime Total */}
                  <div style={{ width: '86px', textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(turnItem.turnWalltime)}
                    </div>
                    <div style={{ fontSize: '0.64rem', color: turnItem.isCached ? 'var(--prefill)' : 'var(--text-subtle)' }}>
                      {turnItem.isCached ? 'cached' : 'full ingest'}
                    </div>
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
                <th>Turn</th>
                <th>Agent Tool Phase</th>
                <th>History Context</th>
                <th>Prefilled Tokens</th>
                <th>Prefill Time</th>
                <th>Decode Time</th>
                <th>Turn Walltime</th>
                <th>Cumulative</th>
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

    </div>
  );
}
