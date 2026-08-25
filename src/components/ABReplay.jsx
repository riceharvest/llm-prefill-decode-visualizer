import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, RotateCcw, Zap, Gauge, Columns2, FileDown, Copy, FileJson } from 'lucide-react';
import {
  HARDWARE_PRESETS,
  SCENARIO_PRESETS,
  formatTime,
  formatTokens
} from '../utils/presets';
import { readParam, readParamNum, consumeAutoplay, writeParams } from '../utils/urlState';
import { clockToRunState, runStateToBusy } from '../utils/viewState';
import usePrefersReducedMotion from '../utils/usePrefersReducedMotion';
import { buildDeepLink, downloadMarkdown, copyMarkdownToClipboard } from '../utils/exportMarkdown';
import { downloadJson } from '../utils/exportJson';
import { buildAbMarkdown, buildAbJson } from '../utils/exportAb';

// Map an /api/presets hardware entry onto the internal preset shape so the
// fetched agent data can seed/extend the lane selectors exactly like the
// bundled HARDWARE_PRESETS.
const fromApiPreset = (h) => ({
  id: h.id,
  name: h.name,
  prefillSpeed: h.prefillSpeedTokPerSec,
  decodeSpeed: h.decodeSpeedTokPerSec,
  icon: '⚙️',
  badge: h.badge || '',
  vramBandwidth: h.vramBandwidth || ''
});

// Analytical replay of one lane at shared sim-clock time t. Both lanes derive
// their full visual state from the same t, which is what keeps them
// frame-synchronized — there is no per-lane animation loop to drift.
function laneStateAt(t, { ttft, total, prefillSpeed, decodeSpeed, promptTokens, outputTokens }) {
  if (t <= 0) {
    return { phase: 'idle', prefillProgress: 0, decodeTokens: 0 };
  }
  if (Number.isFinite(total) && total > 0 && t >= total) {
    return {
      phase: 'completed',
      prefillProgress: Number.isFinite(ttft) ? promptTokens : 0,
      decodeTokens: Number.isFinite(total - ttft) && total - ttft >= 0 ? outputTokens : 0
    };
  }
  if (t <= ttft) {
    return {
      phase: 'prefilling',
      prefillProgress: Math.max(0, Math.min(promptTokens, Math.floor(t * prefillSpeed))),
      decodeTokens: 0
    };
  }
  return {
    phase: 'decoding',
    prefillProgress: promptTokens,
    decodeTokens: Math.max(0, Math.min(outputTokens, Math.floor((t - ttft) * decodeSpeed)))
  };
}

export default function ABReplay({
  simSpeedMultiplier,
  isPlaying,
  setIsPlaying,
  resetKey,
  presets = HARDWARE_PRESETS
}) {
  // Lane configs default to the /api/presets pairing (Groq LPU vs RTX 4090),
  // overridable via URL params like every other tab.
  const [hardwareA, setHardwareA] = useState(() => readParam('abA') || 'groq');
  const [hardwareB, setHardwareB] = useState(() => readParam('abB') || 'rtx4090_exl2');
  const [promptTokens, setPromptTokens] = useState(() => readParamNum('abp', 2048));
  const [outputTokens, setOutputTokens] = useState(() => readParamNum('abo', 512));

  // #693: honor ?autoplay=1 like the single-turn/agentic tabs — demo links
  // into tab=ab used to land paused. consumeAutoplay() makes this fire once
  // per page load only (#818), so remounting the tab doesn't re-start runs.
  const autoplay = useRef(consumeAutoplay());
  useEffect(() => {
    if (!autoplay.current) return undefined;
    const timer = setTimeout(() => setIsPlaying(true), 250);
    return () => clearTimeout(timer);
  }, [setIsPlaying]);

  // /api/presets seeds both lanes: fetched hardware entries extend the selector
  // options and validate the current selection; scenarios come from the same
  // payload. Falls back to bundled constants when the API is unreachable.
  const [apiData, setApiData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/presets')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(data => {
        if (!cancelled && Array.isArray(data?.hardware) && data.hardware.length) {
          setApiData(data);
        }
      })
      .catch(() => { /* static preview / offline — bundled presets still work */ });
    return () => { cancelled = true; };
  }, []);

  const lanePresets = useMemo(() => {
    const apiPresets = (apiData?.hardware || []).map(fromApiPreset)
      .filter(p => Number.isFinite(p.prefillSpeed) && p.prefillSpeed > 0
        && Number.isFinite(p.decodeSpeed) && p.decodeSpeed > 0);
    const seen = new Set(apiPresets.map(p => p.id));
    return [...apiPresets, ...presets.filter(p => !seen.has(p.id))];
  }, [apiData, presets]);

  // If a saved/linked lane id no longer resolves anywhere, reseed it from the
  // first two distinct presets in the merged list.
  useEffect(() => {
    const has = id => lanePresets.some(p => p.id === id);
    const fallback = i => lanePresets[i % Math.max(1, lanePresets.length)]?.id;
    if (!has(hardwareA)) setHardwareA(fallback(0));
    if (!has(hardwareB)) setHardwareB(fallback(1));
  }, [lanePresets, hardwareA, hardwareB]);

  const scenarioPresets = apiData?.scenarios?.length ? apiData.scenarios : SCENARIO_PRESETS;

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({
      abA: hardwareA, abB: hardwareB,
      abp: promptTokens, abo: outputTokens
    });
  }, [hardwareA, hardwareB, promptTokens, outputTokens]);

  const presetA = lanePresets.find(p => p.id === hardwareA) || lanePresets[0] || HARDWARE_PRESETS[0];
  const presetB = lanePresets.find(p => p.id === hardwareB) || lanePresets[1] || HARDWARE_PRESETS[1];

  // Shared workload → per-lane walltime math (same model as HardwareComparison)
  const safePromptTokens = Math.max(0, promptTokens || 0);
  const safeOutputTokens = Math.max(0, outputTokens || 0);
  const ttftA = presetA.prefillSpeed > 0 ? safePromptTokens / presetA.prefillSpeed : Infinity;
  const ttftB = presetB.prefillSpeed > 0 ? safePromptTokens / presetB.prefillSpeed : Infinity;
  const decodeTimeA = presetA.decodeSpeed > 0 ? safeOutputTokens / presetA.decodeSpeed : Infinity;
  const decodeTimeB = presetB.decodeSpeed > 0 ? safeOutputTokens / presetB.decodeSpeed : Infinity;
  const totalA = ttftA + decodeTimeA;
  const totalB = ttftB + decodeTimeB;

  // The master clock runs to whichever lane finishes last, so the slower
  // system's tail is visible instead of being cut off at the winner's finish.
  const masterTotal = Math.max(totalA, totalB);

  // Shared timeline scrubber state
  const [simTime, setSimTime] = useState(0);
  const animFrameRef = useRef(null);
  const lastTickRef = useRef(null);
  const simTimeRef = useRef(0);

  const seekTo = (t) => {
    const clamped = Math.max(0, Math.min(masterTotal, t));
    simTimeRef.current = clamped;
    setSimTime(clamped);
  };

  const handleReset = () => {
    seekTo(0);
    setIsPlaying(false);
  };

  // Global Reset button (App resetKey) clears the shared timeline too
  const resetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      handleReset();
    }
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Config changes restart the replay from zero, like the other tabs
  useEffect(() => {
    handleReset();
  }, [hardwareA, hardwareB, promptTokens, outputTokens]); // eslint-disable-line react-hooks/exhaustive-deps

  const prefersReducedMotion = usePrefersReducedMotion();

  // Single frame-synchronized playback loop for BOTH lanes
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      lastTickRef.current = null;
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

      // Non-finite master timeline (e.g. a lane with zero speed): jump to done
      if (!Number.isFinite(masterTotal) || masterTotal <= 0) {
        seekTo(0);
        setIsPlaying(false);
        return;
      }

      // Instant mode — or prefers-reduced-motion (issue #63): complete the
      // whole synchronized run in one frame with no motion.
      if (simSpeedMultiplier === 'instant' || prefersReducedMotion) {
        seekTo(masterTotal);
        setIsPlaying(false);
        return;
      }

      const next = simTimeRef.current + realDeltaSec * simSpeedMultiplier;
      if (next >= masterTotal) {
        seekTo(masterTotal);
        setIsPlaying(false);
        return;
      }
      simTimeRef.current = next;
      setSimTime(next);
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, simSpeedMultiplier, prefersReducedMotion, masterTotal, setIsPlaying]);

  // Derive both lanes' visuals from the SAME clock value — this is the
  // frame-synchronization guarantee. No per-lane timers exist.
  const laneAView = laneStateAt(simTime, {
    ttft: ttftA, total: totalA,
    prefillSpeed: presetA.prefillSpeed, decodeSpeed: presetA.decodeSpeed,
    promptTokens: safePromptTokens, outputTokens: safeOutputTokens
  });
  const laneBView = laneStateAt(simTime, {
    ttft: ttftB, total: totalB,
    prefillSpeed: presetB.prefillSpeed, decodeSpeed: presetB.decodeSpeed,
    promptTokens: safePromptTokens, outputTokens: safeOutputTokens
  });

  const activeScenario = scenarioPresets.find(s => s.promptTokens === promptTokens && s.outputTokens === outputTokens);

  const speedupTotal = totalA > 0 && Number.isFinite(totalA) ? totalB / totalA : 0;
  const winnerLabel = speedupTotal > 1
    ? `${presetA.name} finishes first`
    : speedupTotal < 1 && speedupTotal > 0
      ? `${presetB.name} finishes first`
      : 'Dead heat';

  // Issue #403: Export MD / Export JSON / Copy MD — the same machine-readable
  // exit the single-turn view ships, so the comparison outlives the animation.
  const [abCopied, setAbCopied] = useState(false);
  const [abCopyFailed, setAbCopyFailed] = useState(false);
  const abExportArgs = () => ({
    presetA,
    presetB,
    promptTokens: safePromptTokens,
    outputTokens: safeOutputTokens,
    ttftA,
    ttftB,
    decodeTimeA,
    decodeTimeB,
    totalA,
    totalB,
    deepLink: buildDeepLink('ab')
  });
  const handleExportMd = () => downloadMarkdown(buildAbMarkdown(abExportArgs()), 'ab-replay-comparison.md');
  const handleExportJson = () => downloadJson(buildAbJson(abExportArgs()), 'ab-replay-comparison.json');
  const handleCopyMd = async () => {
    const ok = await copyMarkdownToClipboard(buildAbMarkdown(abExportArgs()));
    // Issue #401 parity: never claim success over a failed clipboard write.
    setAbCopied(ok);
    setAbCopyFailed(!ok);
    setTimeout(() => { setAbCopied(false); setAbCopyFailed(false); }, 2000);
  };

  const phaseTagClass = v => v.phase === 'prefilling' ? 'tag-prefill'
    : v.phase === 'decoding' || v.phase === 'completed' ? 'tag-decode' : '';
  const phaseLabel = v => v.phase === 'idle' ? 'READY'
    : v.phase === 'prefilling' ? 'PREFILL'
      : v.phase === 'decoding' ? 'DECODE' : 'DONE';

  // Screen-reader run summary (issue #63): aria-live narration of both lanes.
  // Text only changes on lane phase transitions and at completion, so the
  // synchronized rAF loop never floods assistive tech with per-frame output.
  const srSummary = simTime <= 0
    ? 'A/B replay idle. Pick two systems and press Simulate Run.'
    : simTime >= masterTotal
      ? `Replay complete. ${winnerLabel}: ${presetA.name} in ${formatTime(totalA)}, ${presetB.name} in ${formatTime(totalB)}.`
      : `${presetA.name}: ${phaseLabel(laneAView) === 'DONE' ? 'finished' : 'still running, ' + phaseLabel(laneAView).toLowerCase()}. ${presetB.name}: ${phaseLabel(laneBView) === 'DONE' ? 'finished' : 'still running, ' + phaseLabel(laneBView).toLowerCase()}.`;

  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.82rem' };
  const numStyle = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 };

  const renderLane = ({ letter, tagline, accentBorder, preset, view, ttft, totalTime }) => (
    <div className="panel-inset" style={{ borderLeft: `2px solid ${accentBorder}` }}>
      {/* #404: real heading role so lane structure survives text extraction */}
      <h3 className="section-label" style={{ marginBottom: '8px' }}>
        System {letter} · {tagline}
      </h3>
      <select
        value={preset.id}
        onChange={(e) => (letter === 'A' ? setHardwareA : setHardwareB)(e.target.value)}
        aria-label={`System ${letter} hardware profile`}
        style={{ width: '100%', marginBottom: '6px' }}
      >
        {lanePresets.map(p => (
          <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
        ))}
      </select>
      {/* #404: restate the selected profile as plain text — text-based readers
          see every option label inline in the select and could not tell which
          system was being compared. */}
      <div className="hint-text" style={{ marginBottom: '14px', fontSize: '0.72rem' }}>
        Selected: <strong>{preset.icon} {preset.name}</strong>
      </div>

      <div style={rowStyle}>
        <span>Prefill</span>
        <span style={{ ...numStyle, color: 'var(--prefill)' }}>{preset.prefillSpeed.toLocaleString()} tok/s</span>
      </div>
      <div style={{ ...rowStyle, marginBottom: '10px' }}>
        <span>Decode</span>
        <span style={{ ...numStyle, color: 'var(--decode)' }}>{preset.decodeSpeed.toLocaleString()} tok/s</span>
      </div>

      {/* Prefill progress (rAF-driven width via sim clock — no CSS transition) */}
      <div className="field-head" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
        <span>
          <Zap size={12} style={{ verticalAlign: '-2px', marginInlineEnd: '3px', color: 'var(--prefill)' }} />
          Prefill {view.prefillProgress.toLocaleString()} / {safePromptTokens.toLocaleString()} tok
        </span>
        <span className={`tag ${phaseTagClass(view)}`} style={{ fontSize: '0.62rem', padding: '2px 6px' }}>
          {phaseLabel(view)}
        </span>
      </div>
      <div className="progress-track" style={{ margin: '0 0 8px' }}>
        <div
          className="progress-fill"
          style={{
            width: `${safePromptTokens > 0 ? Math.min(100, (view.prefillProgress / safePromptTokens) * 100) : 0}%`,
            background: 'var(--prefill)'
          }}
        />
      </div>

      {/* Decode progress */}
      <div className="field-head" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
        <span>
          <Gauge size={12} style={{ verticalAlign: '-2px', marginInlineEnd: '3px', color: 'var(--decode)' }} />
          Decode {view.decodeTokens.toLocaleString()} / {safeOutputTokens.toLocaleString()} tok
        </span>
        <span style={{ ...numStyle, fontSize: '0.72rem' }}>{view.decodeTokens > 0 && preset.decodeSpeed > 0 ? `${Math.round(view.decodeTokens / ((simTime - ttft) || 1e-9))} tok/s live` : ''}</span>
      </div>
      <div className="progress-track" style={{ margin: '0 0 10px' }}>
        <div
          className="progress-fill"
          style={{
            width: `${safeOutputTokens > 0 ? Math.min(100, (view.decodeTokens / safeOutputTokens) * 100) : 0}%`,
            background: 'var(--decode)'
          }}
        />
      </div>

      <div style={{ ...rowStyle }}>
        <span>TTFT</span>
        <span style={{ ...numStyle, color: 'var(--prefill)' }}>{formatTime(ttft)}</span>
      </div>
      <div style={{ ...rowStyle, fontWeight: 700, color: 'var(--text-main)' }}>
        <span>Total walltime</span>
        <span style={{ ...numStyle, color: 'var(--accent)' }}>{formatTime(totalTime)}</span>
      </div>
      {view.phase === 'decoding' && (
        <p className="hint-text" style={{ marginTop: '8px' }}>
          ETA {formatTime(Math.max(0, totalTime - simTime))} remaining on the shared clock.
        </p>
      )}
    </div>
  );

  return (
    <div className="stack">

      {/* Issue #63: live narration of the synchronized replay for screen readers */}
      <div className="visually-hidden" role="status" aria-live="polite">{srSummary}</div>

      {/* Shared workload parameters */}
      <section className="panel" aria-label="A/B replay parameters">
        <h2 className="panel-title" style={{ marginBottom: '14px' }} tabIndex={-1} data-panel-heading>
          <Columns2 size={16} />
          <span>Side-by-Side A/B Replay</span>
        </h2>

        <p className="hint-text" style={{ marginBottom: '14px' }}>
          The same turn runs on two configs against one shared, scrubbable timeline — watch TTFT and
          decode diverge in walltime as it plays. Lane data seeded from <code>/api/presets</code>.
        </p>

        {/* Workload scenario presets (shared by both lanes) */}
        <div className="seg" role="group" aria-label="Workload scenario presets" style={{ marginBottom: '14px', flexWrap: 'wrap' }}>
          {scenarioPresets.map(s => (
            <button
              key={s.id}
              onClick={() => { setPromptTokens(s.promptTokens); setOutputTokens(s.outputTokens); }}
              className={activeScenario?.id === s.id ? 'active' : ''}
              aria-pressed={activeScenario?.id === s.id}
              title={`${s.promptTokens.toLocaleString()} prompt → ${s.outputTokens.toLocaleString()} output tokens`}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        <div className="grid-auto" style={{ '--grid-min': '17.5rem' }}>
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Shared Input Prompt Length</span>
              <span className="field-value" style={{ color: 'var(--prefill)' }}>{formatTokens(promptTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="128"
                max="32768"
                step="128"
                value={promptTokens}
                aria-label="Shared input prompt length in tokens"
                aria-valuetext={`${promptTokens.toLocaleString()} tokens`}
                onChange={(e) => setPromptTokens(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={promptTokens}
                aria-label="Shared input prompt length value"
                onChange={(e) => setPromptTokens(Number(e.target.value))}
                style={{ width: '5rem' }}
              />
            </div>
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Shared Target Output Length</span>
              <span className="field-value" style={{ color: 'var(--decode)' }}>{formatTokens(outputTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="32"
                max="4096"
                step="32"
                value={outputTokens}
                aria-label="Shared target output length in tokens"
                aria-valuetext={`${outputTokens.toLocaleString()} tokens`}
                onChange={(e) => setOutputTokens(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={outputTokens}
                aria-label="Shared target output length value"
                onChange={(e) => setOutputTokens(Number(e.target.value))}
                style={{ width: '5rem' }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Synchronized stage: shared transport + both lanes */}
      <section
        className="panel"
        aria-label="Synchronized A/B simulation stage"
        data-state={clockToRunState(simTime, masterTotal)}
        aria-busy={runStateToBusy(clockToRunState(simTime, masterTotal))}
      >

        {/* Shared transport controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className={`tag ${simTime <= 0 ? '' : phaseTagClass(laneAView.phase === 'idle' ? laneBView : laneAView)}`} style={{ fontSize: '0.72rem', padding: '3px 9px' }}>
              {simTime <= 0 ? 'READY' : phaseLabel(laneAView.phase === 'idle' ? laneBView : laneAView)}
            </span>
            <span className="hint-text" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {formatTime(Math.min(simTime, masterTotal))} <span style={{ color: 'var(--text-subtle)' }}>/ {formatTime(masterTotal)}</span>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`btn ${isPlaying ? 'btn-warn' : 'btn-accent'}`}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              {isPlaying ? 'Pause' : (simTime > 0 && simTime < masterTotal ? 'Resume' : 'Simulate Run')}
            </button>
            <button
              onClick={handleReset}
              type="button"
              title="Reset the shared timeline"
              aria-label="Reset the shared timeline"
              className="btn"
            >
              <RotateCcw size={15} />
              Reset
            </button>

            {/* Issue #403: export the comparison as a scrapeable artifact */}
            <button onClick={handleExportMd} className="btn" title="Export this A/B comparison as markdown (download)">
              <FileDown size={15} />
              Export MD
            </button>
            <button onClick={handleExportJson} className="btn" title="Export this A/B comparison as machine-readable JSON (download)">
              <FileJson size={15} />
              Export JSON
            </button>
            <button
              onClick={handleCopyMd}
              className="btn"
              title="Copy the markdown comparison to the clipboard"
              aria-label="Copy A/B comparison to clipboard"
            >
              <Copy size={15} />
              {abCopied ? 'Copied!' : abCopyFailed ? 'Copy failed' : 'Copy MD'}
            </button>
          </div>
        </div>

        {/* Shared timeline scrubber — drives both lanes */}
        <div className="panel-inset" style={{ marginBottom: '18px' }}>
          <div className="field-head" style={{ marginBottom: '6px' }}>
            <span className="field-label">Shared Timeline (both lanes locked)</span>
            <span className="field-value">
              {masterTotal > 0 && Number.isFinite(masterTotal)
                ? `${Math.round((simTime / masterTotal) * 100)}%`
                : '—'}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max={Number.isFinite(masterTotal) ? masterTotal : 1}
            step={Number.isFinite(masterTotal) && masterTotal > 0 ? masterTotal / 1000 : 0.001}
            value={Math.min(simTime, masterTotal)}
            aria-label="Shared A/B timeline position in simulated seconds"
            aria-valuetext={`${Math.min(simTime, masterTotal).toFixed(1)} simulated seconds`}
            onChange={(e) => seekTo(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <div className="field-scale">
            <span>t = 0 · request starts</span>
            <span>winner: {formatTime(Math.min(totalA, totalB))}</span>
            <span>t = {formatTime(masterTotal)} · slowest lane done</span>
          </div>
        </div>

        {/* Two lanes, one clock */}
        <div className="grid-auto" style={{ '--grid-min': '18.75rem' }}>
          {renderLane({
            letter: 'A', tagline: 'primary', accentBorder: 'var(--accent)',
            preset: presetA, view: laneAView, ttft: ttftA, totalTime: totalA
          })}
          {renderLane({
            letter: 'B', tagline: 'comparison', accentBorder: 'var(--border-strong)',
            preset: presetB, view: laneBView, ttft: ttftB, totalTime: totalB
          })}
        </div>

        {/* Result summary */}
        <div className="metric-grid" style={{ marginTop: '16px' }}>
          <div
            className="metric"
            style={{ borderInlineStartColor: speedupTotal >= 1 ? 'var(--decode)' : 'var(--danger)', textAlign: 'center' }}
          >
            <div className="metric-label">Overall walltime</div>
            <div className="metric-value" style={{ color: speedupTotal >= 1 ? 'var(--decode)' : 'var(--danger)', fontSize: '1.5rem' }}>
              {speedupTotal > 0 ? (speedupTotal >= 1 ? `${speedupTotal.toFixed(2)}x faster` : `${(1 / speedupTotal).toFixed(2)}x slower`) : '—'}
            </div>
            <div className="metric-sub">System A vs System B</div>
          </div>
          <div className="metric" style={{ borderInlineStartColor: 'var(--prefill)', textAlign: 'center' }}>
            <div className="metric-label">TTFT advantage</div>
            <div className="metric-value" style={{ color: 'var(--prefill)' }}>
              {ttftA > 0 && Number.isFinite(ttftA) ? `${(ttftB / ttftA).toFixed(2)}x` : '—'}
            </div>
          </div>
          <div className="metric" style={{ borderInlineStartColor: 'var(--agent)', textAlign: 'center' }}>
            <div className="metric-label">First to finish</div>
            <div className="metric-value" style={{ fontSize: '1rem' }}>{winnerLabel}</div>
          </div>
        </div>

      </section>

    </div>
  );
}
