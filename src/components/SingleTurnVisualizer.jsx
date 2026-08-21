import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Zap, Gauge, FileText, RotateCcw } from 'lucide-react';
import { formatTime, formatTokens, SCENARIO_PRESETS } from '../utils/presets';
import { readParamNum, readParam, readParamBool, writeParams } from '../utils/urlState';

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

  const effectiveDecodeSpeed = (() => {
    if (!specEnabled) return decodeSpeed;
    const k = draftTokens;
    const alpha = acceptance;
    const draftCost = 0.2; // draft model step costs ~20% of a target step
    const tokensPerStep = 1 + k * alpha;           // accepted drafts + the bonus token
    const stepsPerSecond = decodeSpeed / (1 + k * draftCost);
    return stepsPerSecond * tokensPerStep;
  })();

  const activeScenario = SCENARIO_PRESETS.find(s => s.promptTokens === promptTokens && s.outputTokens === outputTokens);

  const applyScenario = (scenario) => {
    setPromptTokens(scenario.promptTokens);
    setOutputTokens(scenario.outputTokens);
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
      prompt: promptTokens,
      output: outputTokens,
      spec: specEnabled ? '1' : '',
      draftK: specEnabled ? draftTokens : '',
      acc: specEnabled ? acceptance : ''
    });
  }, [promptTokens, outputTokens, specEnabled, draftTokens, acceptance]);

  // Simulation state
  const [phase, setPhase] = useState('idle'); // 'idle' | 'prefilling' | 'decoding' | 'completed'
  const [currentPrefillProgress, setCurrentPrefillProgress] = useState(0); // 0 to promptTokens
  const [currentDecodeTokens, setCurrentDecodeTokens] = useState(0); // 0 to outputTokens
  const [elapsedTime, setElapsedTime] = useState(0); // seconds

  // Calculated benchmarks (typed 0/negative values sanitized for math)
  const safePromptTokens = Math.max(0, promptTokens || 0);
  const safeOutputTokens = Math.max(0, outputTokens || 0);
  const expectedTTFT = safePromptTokens / prefillSpeed; // seconds
  const expectedDecodeTime = safeOutputTokens / effectiveDecodeSpeed; // seconds (spec-aware)
  const expectedTotalTime = expectedTTFT + expectedDecodeTime;
  const tpotMs = effectiveDecodeSpeed > 0 ? 1000 / effectiveDecodeSpeed : Infinity;

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
        setCurrentPrefillProgress(Number.isFinite(expectedTTFT) && expectedTTFT >= 0 ? Math.max(0, promptTokens) : 0);
        setCurrentDecodeTokens(Number.isFinite(expectedDecodeTime) && expectedDecodeTime >= 0 ? Math.max(0, outputTokens) : 0);
        setElapsedTime(expectedTotalTime);
        setPhase('completed');
        setIsPlaying(false);
        return;
      }

      // Handle instant mode
      if (simSpeedMultiplier === 'instant') {
        setCurrentPrefillProgress(safePromptTokens);
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
        const prefillProgress = Math.max(0, Math.min(safePromptTokens, Math.floor(newTime * prefillSpeed)));
        setCurrentPrefillProgress(prefillProgress);
      } else if (newTime < expectedTotalTime) {
        setPhase('decoding');
        setCurrentPrefillProgress(safePromptTokens);
        const decodeProgressTime = newTime - expectedTTFT;
        const decodeCount = Math.max(0, Math.min(safeOutputTokens, Math.floor(decodeProgressTime * effectiveDecodeSpeed)));
        setCurrentDecodeTokens(decodeCount);
      } else {
        // Completed
        setPhase('completed');
        setCurrentPrefillProgress(safePromptTokens);
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
  }, [isPlaying, simSpeedMultiplier, promptTokens, outputTokens, prefillSpeed, decodeSpeed, effectiveDecodeSpeed, expectedTTFT, expectedTotalTime]);

  const prefillPct = Number.isFinite(expectedTotalTime) && expectedTotalTime > 0 ? (expectedTTFT / expectedTotalTime) * 100 : 0;
  const decodePct = Number.isFinite(expectedTotalTime) && expectedTotalTime > 0 ? (expectedDecodeTime / expectedTotalTime) * 100 : 0;

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

  const phaseLabel = phase === 'idle' ? 'READY'
    : phase === 'prefilling' ? 'PHASE 1 · PREFILL'
    : phase === 'decoding' ? 'PHASE 2 · DECODE'
    : 'COMPLETED';
  const phaseTagClass = phase === 'prefilling' ? 'tag-prefill'
    : phase === 'decoding' || phase === 'completed' ? 'tag-decode' : '';

  return (
    <div className="stack">

      {/* Top Parameter Cards */}
      <section className="panel" aria-label="Single-turn chat parameters">
        <h2 className="panel-title" style={{ marginBottom: '14px' }}>
          <FileText size={16} />
          <span>Single-Turn Chat Parameters</span>
        </h2>

        {/* Workload scenario presets */}
        <div className="seg" role="group" aria-label="Workload scenario presets" style={{ marginBottom: '14px', flexWrap: 'wrap' }}>
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
              ⚡ Speculative Decoding: {specEnabled ? 'ON' : 'OFF'}
            </button>
            {specEnabled && (
              <span className="tag tag-decode">
                effective {Math.round(effectiveDecodeSpeed).toLocaleString()} tok/s
                {' '}({(effectiveDecodeSpeed / decodeSpeed).toFixed(2)}× vs vanilla)
              </span>
            )}
          </div>
          {specEnabled && (
            <div className="grid-auto" style={{ '--grid-min': '220px' }}>
              <div className="field">
                <div className="field-head">
                  <span className="field-label">Draft tokens / step (k)</span>
                  <span className="field-value" style={{ color: 'var(--agent)' }}>{draftTokens}</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="8"
                  step="1"
                  value={draftTokens}
                  aria-label="Draft tokens proposed per step"
                  onChange={(e) => setDraftTokens(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <div className="field-head">
                  <span className="field-label">Acceptance rate (α)</span>
                  <span className="field-value" style={{ color: 'var(--agent)' }}>{acceptance.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.3"
                  max="0.95"
                  step="0.05"
                  value={acceptance}
                  aria-label="Draft token acceptance rate"
                  onChange={(e) => setAcceptance(Number(e.target.value))}
                />
              </div>
            </div>
          )}
          {specEnabled && (
            <p className="hint-text" style={{ marginTop: '8px' }}>
              Draft model proposes k tokens, target verifies in one pass. Effective speed ≈ base ÷ (1 + k·c_draft) × (1 + k·α), draft cost c≈0.2. Higher α or smaller k → bigger win.
            </p>
          )}
        </div>

        <div className="grid-auto" style={{ '--grid-min': '280px' }}>
          {/* Prompt Tokens Slider */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Input Prompt Length</span>
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
                aria-label="Input prompt length in tokens"
                onChange={(e) => {
                  setPromptTokens(Number(e.target.value));
                  handleReset();
                }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={promptTokens}
                aria-label="Input prompt length value"
                onChange={(e) => {
                  setPromptTokens(Number(e.target.value));
                  handleReset();
                }}
                style={{ width: '80px' }}
              />
            </div>
            <div className="field-scale">
              <span>128 · short</span>
              <span>4,096 · RAG</span>
              <span>32,768 · long doc</span>
            </div>
          </div>

          {/* Target Output Tokens Slider */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Target Output Length</span>
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
                aria-label="Target output generation length in tokens"
                onChange={(e) => {
                  setOutputTokens(Number(e.target.value));
                  handleReset();
                }}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={outputTokens}
                aria-label="Target output generation length value"
                onChange={(e) => {
                  setOutputTokens(Number(e.target.value));
                  handleReset();
                }}
                style={{ width: '80px' }}
              />
            </div>
            <div className="field-scale">
              <span>32 · concise</span>
              <span>512 · standard</span>
              <span>4,096 · code / report</span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Visualizer Stage */}
      <section className="panel" aria-label="Simulation stage">

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
              {isPlaying ? 'Pause' : 'Simulate Run'}
            </button>

            <button
              onClick={handleReset}
              title="Reset simulation (phase, token progress, stream, elapsed time)"
              className="btn"
            >
              <RotateCcw size={15} />
              Reset
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
                Phase 1 · Prefill (TTFT)
              </span>
              <span className="tag tag-prefill">{prefillSpeed.toLocaleString()} tok/s</span>
            </div>

            {/* Progress indicator (rAF-driven width — no transition) */}
            <div className="progress-track" style={{ margin: '10px 0 8px' }}>
              <div
                className="progress-fill"
                style={{
                  width: `${promptTokens > 0 ? Math.min(100, (currentPrefillProgress / promptTokens) * 100) : 0}%`,
                  background: 'var(--prefill)'
                }}
              />
            </div>

            <div className="field-head" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              <span>Ingested <strong style={{ color: 'var(--text-main)' }}>{currentPrefillProgress.toLocaleString()}</strong> / {promptTokens.toLocaleString()} tok</span>
              <span>TTFT <strong style={{ color: 'var(--prefill)' }}>{formatTime(expectedTTFT)}</strong></span>
            </div>

            <p className="hint-text" style={{ marginTop: '8px' }}>
              Compute-bound parallel matrix multiplication. Builds the KV cache for all {promptTokens.toLocaleString()} prompt tokens.
            </p>
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
                Phase 2 · Decode (Generation)
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
              <span>Decode <strong style={{ color: 'var(--decode)' }}>{formatTime(expectedDecodeTime)}</strong></span>
            </div>

            <p className="hint-text" style={{ marginTop: '8px' }}>
              Memory-bandwidth bound autoregressive loop. Reads all model weights &amp; KV cache per generated token.
            </p>
          </div>

        </div>

        {/* Dynamic Token Stream & Simulated Output */}
        <div className="panel-inset" style={{ marginBottom: '20px' }}>
          <div className="field-head" style={{ marginBottom: '10px' }}>
            <span className="section-label">
              Decode stream · {currentDecodeTokens} tokens
            </span>
            <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--decode)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              TPOT {Number.isFinite(tpotMs) ? `${tpotMs.toFixed(1)} ms` : '∞ ms'}
            </span>
          </div>

          <div className="stream-box">
            {streamWordsVisible.length === 0 ? (
              <span className="stream-placeholder">
                {phase === 'prefilling'
                  ? 'Ingesting prompt — prefill phase active…'
                  : totalStreamWords > 0
                    ? `Window ${streamLap} complete — clearing & continuing…`
                    : 'Press "Simulate Run" to watch the token stream.'}
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
        </div>

        {/* Walltime & Performance Breakdown Cards */}
        <div className="metric-grid">

          <div className="metric" style={{ borderLeftColor: 'var(--prefill)' }}>
            <div className="metric-label">TTFT · time to first token</div>
            <div className="metric-value" style={{ color: 'var(--prefill)' }}>
              {formatTime(expectedTTFT)}
            </div>
            <div className="metric-sub">Prompt prefill latency</div>
          </div>

          <div className="metric" style={{ borderLeftColor: 'var(--decode)' }}>
            <div className="metric-label">TPOT · time per output token</div>
            <div className="metric-value" style={{ color: 'var(--decode)' }}>
              {Number.isFinite(tpotMs) ? `${tpotMs.toFixed(1)} ms` : '∞ ms'}
            </div>
            <div className="metric-sub">{decodeSpeed} tokens / sec</div>
          </div>

          <div className="metric" style={{ borderLeftColor: 'var(--accent)' }}>
            <div className="metric-label">Total chat walltime</div>
            <div className="metric-value">
              {formatTime(expectedTotalTime)}
            </div>
            <div className="metric-sub">Prefill + decode combined</div>
          </div>

          <div className="metric" style={{ borderLeftColor: 'var(--agent)' }}>
            <div className="metric-label">Effective throughput</div>
            <div className="metric-value">
              {!Number.isFinite(expectedTotalTime)
                ? '0.0 '
                : expectedTotalTime > 0
                  ? `${((promptTokens + outputTokens) / expectedTotalTime).toFixed(1)} `
                  : '— '}
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>tok/s</span>
            </div>
            <div className="metric-sub">Total tokens ÷ walltime</div>
          </div>

        </div>

        {/* Stacked Walltime Percentage Bar */}
        <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
          <div className="field-head" style={{ marginBottom: '8px' }}>
            <span className="section-label">Walltime distribution</span>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              Prefill <strong style={{ color: 'var(--prefill)' }}>{prefillPct.toFixed(1)}%</strong>
              {' · '}Decode <strong style={{ color: 'var(--decode)' }}>{decodePct.toFixed(1)}%</strong>
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
              title={`Prefill Time: ${formatTime(expectedTTFT)} (${prefillPct.toFixed(1)}%)`}
            >
              {prefillPct > 8 && `PREFILL ${prefillPct.toFixed(0)}%`}
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
              title={`Decode Time: ${formatTime(expectedDecodeTime)} (${decodePct.toFixed(1)}%)`}
            >
              {decodePct > 8 && `DECODE ${decodePct.toFixed(0)}%`}
            </div>
          </div>
        </div>

      </section>

    </div>
  );
}
