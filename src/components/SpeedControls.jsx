import React from 'react';
import { Play, Pause, RotateCcw, FastForward, Gauge, Zap } from 'lucide-react';

export default function SpeedControls({
  prefillSpeed,
  setPrefillSpeed,
  decodeSpeed,
  setDecodeSpeed,
  simSpeedMultiplier,
  setSimSpeedMultiplier,
  isPlaying,
  setIsPlaying,
  onReset
}) {
  return (
    <section className="panel" aria-label="Simulation speed controls">
      <div className="grid-auto" style={{ '--grid-min': '280px', alignItems: 'stretch' }}>

        {/* Prefill Speed Input */}
        <div className="panel-inset" style={{ borderLeft: '2px solid var(--prefill)' }}>
          <div className="field-head" style={{ marginBottom: '10px' }}>
            <span className="panel-title" style={{ color: 'var(--prefill)' }}>
              <Zap size={15} style={{ color: 'var(--prefill)' }} />
              Prefill Speed
            </span>
            <span className="tag tag-prefill">compute bound</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="range"
              min="50"
              max="50000"
              step="50"
              value={prefillSpeed}
              aria-label="Prefill speed in tokens per second"
              onChange={(e) => setPrefillSpeed(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              value={prefillSpeed}
              aria-label="Prefill speed value"
              onChange={(e) => setPrefillSpeed(Number(e.target.value))}
              style={{ width: '88px' }}
            />
            <span className="field-label">tok/s</span>
          </div>
          <p className="hint-text" style={{ marginTop: '8px' }}>
            Prompt processing — parallel ingestion of all prompt tokens into the KV cache (sets TTFT)
          </p>
        </div>

        {/* Decode Speed Input */}
        <div className="panel-inset" style={{ borderLeft: '2px solid var(--decode)' }}>
          <div className="field-head" style={{ marginBottom: '10px' }}>
            <span className="panel-title" style={{ color: 'var(--decode)' }}>
              <Gauge size={15} style={{ color: 'var(--decode)' }} />
              Decode Speed
            </span>
            <span className="tag tag-decode">bandwidth bound</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="range"
              min="2"
              max="1000"
              step="1"
              value={decodeSpeed}
              aria-label="Decode speed in tokens per second"
              onChange={(e) => setDecodeSpeed(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              value={decodeSpeed}
              aria-label="Decode speed value"
              onChange={(e) => setDecodeSpeed(Number(e.target.value))}
              style={{ width: '88px' }}
            />
            <span className="field-label">tok/s</span>
          </div>
          <p className="hint-text" style={{ marginTop: '8px' }}>
            Token generation — 1 token per step (TPOT = {decodeSpeed > 0 ? (1000 / decodeSpeed).toFixed(1) : '∞'} ms/tok)
          </p>
        </div>

        {/* Simulation Speed & Controls */}
        <div className="panel-inset" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
          <div className="field-head">
            <span className="panel-title">
              <FastForward size={15} />
              Time Scale
            </span>
            <div className="seg" role="group" aria-label="Visual time scale">
              {[1, 2, 5, 20, 'instant'].map(mult => (
                <button
                  key={mult}
                  onClick={() => setSimSpeedMultiplier(mult)}
                  className={simSpeedMultiplier === mult ? 'active' : ''}
                  aria-pressed={simSpeedMultiplier === mult}
                >
                  {mult === 'instant' ? 'INST' : `${mult}x`}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`btn ${isPlaying ? 'btn-warn' : 'btn-accent'}`}
              style={{ flex: 1 }}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              <span>{isPlaying ? 'Pause Simulation' : 'Start Simulation'}</span>
            </button>

            <button
              onClick={onReset}
              title="Reset visualizer"
              aria-label="Reset visualizer"
              className="btn btn-icon"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

      </div>
    </section>
  );
}
