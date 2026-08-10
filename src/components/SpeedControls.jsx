import React from 'react';
import { Play, Pause, RotateCcw, FastForward, Activity, Gauge, Flame } from 'lucide-react';
import { formatTime } from '../utils/presets';

export default function SpeedControls({
  prefillSpeed,
  setPrefillSpeed,
  decodeSpeed,
  setDecodeSpeed,
  simSpeedMultiplier,
  setSimSpeedMultiplier,
  isPlaying,
  setIsPlaying,
  onReset,
  activePhase = 'idle'
}) {
  return (
    <div className="material-card" style={{ padding: '20px', margin: '16px 16px 0 16px', background: '#FFFFFF' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', alignItems: 'center' }}>
        
        {/* Prefill Speed Input */}
        <div style={{
          padding: '14px',
          borderRadius: '12px',
          background: '#EFF6FF',
          border: '1px solid #BFDBFE'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={18} color="#2563EB" />
              <span style={{ fontWeight: '700', fontSize: '0.9rem', color: '#1E40AF' }}>
                Prefill Speed (Prompt Processing)
              </span>
            </div>
            <span className="badge badge-prefill" style={{ fontSize: '0.7rem' }}>
              Compute Bound
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="range"
              min="50"
              max="50000"
              step="50"
              value={prefillSpeed}
              onChange={(e) => setPrefillSpeed(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="number"
                value={prefillSpeed}
                onChange={(e) => setPrefillSpeed(Math.max(1, Number(e.target.value)))}
                style={{ width: '90px', textAlign: 'right' }}
              />
              <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#3B82F6' }}>tok/s</span>
            </div>
          </div>
          <p style={{ fontSize: '0.73rem', color: '#3B82F6', marginTop: '6px' }}>
            Processes all prompt tokens in parallel to generate initial KV Cache (TTFT)
          </p>
        </div>

        {/* Decode Speed Input */}
        <div style={{
          padding: '14px',
          borderRadius: '12px',
          background: '#ECFDF5',
          border: '1px solid #A7F3D0'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Gauge size={18} color="#059669" />
              <span style={{ fontWeight: '700', fontSize: '0.9rem', color: '#065F46' }}>
                Decode Speed (Token Generation)
              </span>
            </div>
            <span className="badge badge-decode" style={{ fontSize: '0.7rem' }}>
              Memory Bandwidth Bound
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="range"
              min="2"
              max="1000"
              step="2"
              value={decodeSpeed}
              onChange={(e) => setDecodeSpeed(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="number"
                value={decodeSpeed}
                onChange={(e) => setDecodeSpeed(Math.max(1, Number(e.target.value)))}
                style={{ width: '90px', textAlign: 'right' }}
              />
              <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#10B981' }}>tok/s</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
            <p style={{ fontSize: '0.73rem', color: '#059669' }}>
              Generates 1 token per step (TPOT = {(1000 / decodeSpeed).toFixed(1)} ms/tok)
            </p>
          </div>
        </div>

        {/* Simulation Speed & Controls */}
        <div style={{
          padding: '14px',
          borderRadius: '12px',
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FastForward size={16} color="#6366F1" />
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>
                Visual Time Scale
              </span>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[1, 2, 5, 20, 'instant'].map(mult => (
                <button
                  key={mult}
                  onClick={() => setSimSpeedMultiplier(mult)}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '6px',
                    border: '1px solid #CBD5E1',
                    background: simSpeedMultiplier === mult ? '#4F46E5' : '#FFFFFF',
                    color: simSpeedMultiplier === mult ? '#FFFFFF' : '#475569',
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  {mult === 'instant' ? '⚡ Instant' : `${mult}x`}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '10px 16px',
                borderRadius: '10px',
                border: 'none',
                background: isPlaying ? '#F59E0B' : 'linear-gradient(135deg, #4F46E5 0%, #3B82F6 100%)',
                color: '#FFFFFF',
                fontWeight: '700',
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: isPlaying ? '0 4px 10px rgba(245, 158, 11, 0.3)' : '0 4px 12px rgba(79, 70, 229, 0.3)',
                transition: 'all 0.15s ease'
              }}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              <span>{isPlaying ? 'Pause Simulation' : 'Start Simulation'}</span>
            </button>

            <button
              onClick={onReset}
              title="Reset Visualizer"
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#475569',
                cursor: 'pointer'
              }}
            >
              <RotateCcw size={18} />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
