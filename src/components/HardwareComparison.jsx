import React, { useState, useEffect } from 'react';
import { HARDWARE_PRESETS, formatTime, formatTokens } from '../utils/presets';
import { BarChart3 } from 'lucide-react';
import { readParam, readParamNum, writeParams } from '../utils/urlState';

export default function HardwareComparison() {
  const [hardwareA, setHardwareA] = useState(() => readParam('hwA') || 'groq');
  const [hardwareB, setHardwareB] = useState(() => readParam('hwB') || 'rtx4090_exl2');
  const [testPromptTokens, setTestPromptTokens] = useState(() => readParamNum('cp', 4096));
  const [testOutputTokens, setTestOutputTokens] = useState(() => readParamNum('co', 512));

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({ hwA: hardwareA, hwB: hardwareB, cp: testPromptTokens, co: testOutputTokens });
  }, [hardwareA, hardwareB, testPromptTokens, testOutputTokens]);

  const presetA = HARDWARE_PRESETS.find(p => p.id === hardwareA) || HARDWARE_PRESETS[0];
  const presetB = HARDWARE_PRESETS.find(p => p.id === hardwareB) || HARDWARE_PRESETS[2];

  const safeCp = Math.max(0, testPromptTokens || 0);
  const safeCo = Math.max(0, testOutputTokens || 0);

  const ttftA = safeCp / presetA.prefillSpeed;
  const decodeTimeA = safeCo / presetA.decodeSpeed;
  const totalTimeA = ttftA + decodeTimeA;

  const ttftB = safeCp / presetB.prefillSpeed;
  const decodeTimeB = safeCo / presetB.decodeSpeed;
  const totalTimeB = ttftB + decodeTimeB;

  const speedupTotal = totalTimeA > 0 ? totalTimeB / totalTimeA : 0;
  const speedupPrefill = ttftA > 0 ? ttftB / ttftA : 0;
  const speedupDecode = decodeTimeA > 0 ? decodeTimeB / decodeTimeA : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px' }}>
      
      <div className="material-card" style={{ padding: '20px', background: '#FFFFFF' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0F172A', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BarChart3 size={22} color="#4F46E5" />
          <span>Side-by-Side Hardware Speed Benchmark</span>
        </h2>

        {/* Benchmark Test Parameters */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '20px' }}>
          <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>Test Prompt Length</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#2563EB' }}>{formatTokens(testPromptTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="512"
                max="32768"
                step="512"
                value={testPromptTokens}
                onChange={(e) => setTestPromptTokens(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={testPromptTokens}
                onChange={(e) => setTestPromptTokens(Number(e.target.value))}
                style={{ width: '80px', textAlign: 'right' }}
              />
            </div>
          </div>

          <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>Test Output Generation</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#059669' }}>{formatTokens(testOutputTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="64"
                max="4096"
                step="64"
                value={testOutputTokens}
                onChange={(e) => setTestOutputTokens(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={testOutputTokens}
                onChange={(e) => setTestOutputTokens(Number(e.target.value))}
                style={{ width: '80px', textAlign: 'right' }}
              />
            </div>
          </div>
        </div>

        {/* Hardware Selectors */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
          
          {/* Hardware Config A */}
          <div style={{ padding: '20px', borderRadius: '14px', background: '#EEF2FF', border: '2px solid #6366F1' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#4F46E5', textTransform: 'uppercase', marginBottom: '8px' }}>
              System A (Primary Benchmark)
            </div>
            <select
              value={hardwareA}
              onChange={(e) => setHardwareA(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid #A5B4FC',
                background: '#FFFFFF',
                fontWeight: '700',
                fontSize: '0.95rem',
                color: '#0F172A',
                marginBottom: '16px'
              }}
            >
              {HARDWARE_PRESETS.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
              ))}
            </select>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Prefill Speed:</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#2563EB' }}>{presetA.prefillSpeed.toLocaleString()} tok/s</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Decode Speed:</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#059669' }}>{presetA.decodeSpeed.toLocaleString()} tok/s</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid #C7D2FE' }}>
                <span>TTFT (Prompt):</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#2563EB' }}>{formatTime(ttftA)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Decode Time:</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#059669' }}>{formatTime(decodeTimeA)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: '800', paddingTop: '8px', borderTop: '1px solid #C7D2FE', color: '#0F172A' }}>
                <span>Total Walltime:</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#4F46E5' }}>{formatTime(totalTimeA)}</span>
              </div>
            </div>
          </div>

          {/* Hardware Config B */}
          <div style={{ padding: '20px', borderRadius: '14px', background: '#F8FAFC', border: '2px solid #CBD5E1' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#64748B', textTransform: 'uppercase', marginBottom: '8px' }}>
              System B (Comparison Benchmark)
            </div>
            <select
              value={hardwareB}
              onChange={(e) => setHardwareB(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                fontWeight: '700',
                fontSize: '0.95rem',
                color: '#0F172A',
                marginBottom: '16px'
              }}
            >
              {HARDWARE_PRESETS.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
              ))}
            </select>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Prefill Speed:</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#2563EB' }}>{presetB.prefillSpeed.toLocaleString()} tok/s</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Decode Speed:</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#059669' }}>{presetB.decodeSpeed.toLocaleString()} tok/s</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid #E2E8F0' }}>
                <span>TTFT (Prompt):</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#2563EB' }}>{formatTime(ttftB)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Decode Time:</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#059669' }}>{formatTime(decodeTimeB)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: '800', paddingTop: '8px', borderTop: '1px solid #E2E8F0', color: '#0F172A' }}>
                <span>Total Walltime:</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatTime(totalTimeB)}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Speedup Ratio Summary Banner */}
        <div style={{
          marginTop: '24px',
          padding: '16px',
          borderRadius: '12px',
          background: speedupTotal >= 1 ? '#ECFDF5' : '#FEF2F2',
          border: `1px solid ${speedupTotal >= 1 ? '#A7F3D0' : '#FECACA'}`,
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#475569' }}>Overall Walltime Speedup</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: '800', color: speedupTotal >= 1 ? '#059669' : '#DC2626' }}>
              {speedupTotal > 0 ? (speedupTotal >= 1 ? `${speedupTotal.toFixed(2)}x Faster` : `${(1 / speedupTotal).toFixed(2)}x Slower`) : '—'}
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#475569' }}>Prefill TTFT Advantage</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.3rem', fontWeight: '800', color: '#2563EB' }}>
              {speedupPrefill.toFixed(2)}x
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#475569' }}>Decode Generation Advantage</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.3rem', fontWeight: '800', color: '#059669' }}>
              {speedupDecode.toFixed(2)}x
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
