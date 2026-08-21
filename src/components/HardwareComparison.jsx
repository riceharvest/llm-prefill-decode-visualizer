import React, { useRef, useState, useEffect } from 'react';
import { HARDWARE_PRESETS, formatTime, formatTokens } from '../utils/presets';
import { BarChart3, Users } from 'lucide-react';
import { readParam, readParamNum, readParamBool, writeParams } from '../utils/urlState';

export default function HardwareComparison({ presets = HARDWARE_PRESETS, localMaxxingContext }) {
  const [hardwareA, setHardwareA] = useState(() => readParam('hwA') || 'groq');
  const [hardwareB, setHardwareB] = useState(() => readParam('hwB') || 'rtx4090_exl2');
  const [batchSize, setBatchSize] = useState(() => Math.max(1, Math.round(readParamNum('batch', 1))));
  const sharedPair = useRef({
    hardwareA,
    hardwareB,
    preserve: hardwareA.startsWith('lmx:') && hardwareB.startsWith('lmx:')
  });
  const [testPromptTokens, setTestPromptTokens] = useState(() => readParamNum('cp', 4096));
  const [testOutputTokens, setTestOutputTokens] = useState(() => readParamNum('co', 512));

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({ hwA: hardwareA, hwB: hardwareB, cp: testPromptTokens, co: testOutputTokens, batch: batchSize === 1 ? '' : batchSize });
  }, [hardwareA, hardwareB, testPromptTokens, testOutputTokens, batchSize]);

  useEffect(() => {
    const localPresets = presets.filter(preset => preset.localMaxxing);
    if (!localPresets.length) return;

    if (sharedPair.current.preserve) {
      const sharedPairIsAvailable = localPresets.some(preset => preset.id === sharedPair.current.hardwareA)
        && localPresets.some(preset => preset.id === sharedPair.current.hardwareB);
      sharedPair.current.preserve = false;
      if (sharedPairIsAvailable) return;
    }

    const preferredId = localMaxxingContext?.selectedRunId
      ? `lmx:${localMaxxingContext.selectedRunId}`
      : localPresets[0].id;
    const primary = localPresets.find(preset => preset.id === preferredId) || localPresets[0];
    const comparison = localPresets.find(preset => preset.hardwareKey !== primary.hardwareKey)
      || localPresets.find(preset => preset.id !== primary.id)
      || primary;

    setHardwareA(primary.id);
    setHardwareB(comparison.id);
  }, [localMaxxingContext?.modelId, localMaxxingContext?.quantization, localMaxxingContext?.selectedRunId, presets]);

  const presetA = presets.find(p => p.id === hardwareA) || presets[0] || HARDWARE_PRESETS[0];
  const presetB = presets.find(p => p.id === hardwareB) || presets[1] || HARDWARE_PRESETS[2];

  const safeCp = Math.max(0, testPromptTokens || 0);
  const safeCo = Math.max(0, testOutputTokens || 0);

  // Batched serving model: prefill throughput scales near-linearly with batch
  // (compute-bound, still GEMM), while decode per-user throughput degrades with
  // batch size (bandwidth shared across sequences — the classic batch tradeoff:
  // aggregate tok/s grows sub-linearly, per-user latency grows ~linearly).
  // Decode efficiency factor: empirical ~1/sqrt(B) per-user decay is too harsh
  // for small B; use B^0.25 penalty which matches measured llama.cpp/vLLM
  // single-GPU curves reasonably in the 1-64 range.
  const decodeEffA = Math.pow(batchSize, -0.25);
  const decodeEffB = decodeEffA; // same relative penalty for both systems
  const batchedPerUserDecodeA = presetA.decodeSpeed * decodeEffA;
  const batchedPerUserDecodeB = presetB.decodeSpeed * decodeEffA;

  const ttftA = safeCp / presetA.prefillSpeed;
  const decodeTimeA = safeCo / batchedPerUserDecodeA;
  const totalTimeA = ttftA + decodeTimeA;

  const ttftB = safeCp / presetB.prefillSpeed;
  const decodeTimeB = safeCo / batchedPerUserDecodeB;
  const totalTimeB = ttftB + decodeTimeB;

  // Aggregate throughput across the batch
  const aggregateTokPerSecA = batchSize * safeCo / (decodeTimeA || 1);
  const aggregateTokPerSecB = batchSize * safeCo / (decodeTimeB || 1);

  const speedupTotal = totalTimeA > 0 ? totalTimeB / totalTimeA : 0;
  const speedupPrefill = ttftA > 0 ? ttftB / ttftA : 0;
  const speedupDecode = decodeTimeA > 0 ? decodeTimeB / decodeTimeA : 0;

  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.82rem' };
  const rowDivider = { paddingTop: '8px', borderTop: '1px solid var(--border)' };
  const numStyle = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 };

  return (
    <div className="stack">

      <section className="panel" aria-label="Hardware comparison">
        <h2 className="panel-title" style={{ marginBottom: '14px' }}>
          <BarChart3 size={16} />
          <span>Side-by-Side Hardware Benchmark</span>
        </h2>

        {localMaxxingContext?.runs?.length > 0 && (
          <div className="panel-inset" style={{ marginBottom: '14px', borderColor: 'var(--prefill-border)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: '0.76rem', fontWeight: 600 }}>
            Comparing {localMaxxingContext.modelId} at {localMaxxingContext.quantization} across {localMaxxingContext.runs.length} measured single-stream runs. Select either system below to change hardware.
          </div>
        )}

        {/* Benchmark Test Parameters */}
        <div className="grid-auto" style={{ '--grid-min': '240px', marginBottom: '16px' }}>
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Test Prompt Length</span>
              <span className="field-value" style={{ color: 'var(--prefill)' }}>{formatTokens(testPromptTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="512"
                max="32768"
                step="512"
                value={testPromptTokens}
                aria-label="Test prompt length in tokens"
                onChange={(e) => setTestPromptTokens(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={testPromptTokens}
                aria-label="Test prompt length value"
                onChange={(e) => setTestPromptTokens(Number(e.target.value))}
                style={{ width: '80px' }}
              />
            </div>
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Test Output Generation</span>
              <span className="field-value" style={{ color: 'var(--decode)' }}>{formatTokens(testOutputTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="64"
                max="4096"
                step="64"
                value={testOutputTokens}
                aria-label="Test output generation length in tokens"
                onChange={(e) => setTestOutputTokens(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={testOutputTokens}
                aria-label="Test output generation length value"
                onChange={(e) => setTestOutputTokens(Number(e.target.value))}
                style={{ width: '80px' }}
              />
            </div>
          </div>

          {/* Concurrent batch size */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">
                <Users size={13} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
                Concurrent Users (batch)
              </span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{batchSize}×</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="1"
                max="64"
                step="1"
                value={batchSize}
                aria-label="Concurrent user batch size"
                onChange={(e) => setBatchSize(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={batchSize}
                aria-label="Concurrent user batch size value"
                onChange={(e) => setBatchSize(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                style={{ width: '80px' }}
              />
            </div>
            <p className="hint-text" style={{ marginTop: '6px' }}>
              {batchSize === 1
                ? 'Single stream — per-user speeds are the raw benchmark numbers.'
                : `Decode shared ${batchSize}-way: per-user speed drops ~B^0.25, aggregate tok/s still rises.`}
            </p>
          </div>
        </div>

        {/* Hardware Selectors */}
        <div className="grid-auto" style={{ '--grid-min': '300px' }}>

          {/* Hardware Config A */}
          <div className="panel-inset" style={{ borderColor: 'var(--prefill-border)', borderLeft: '2px solid var(--accent)' }}>
            <div className="section-label" style={{ color: 'var(--accent)', marginBottom: '8px' }}>
              System A · primary
            </div>
            <select
              value={hardwareA}
              onChange={(e) => setHardwareA(e.target.value)}
              aria-label="System A hardware profile"
              style={{ width: '100%', marginBottom: '14px' }}
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
              ))}
            </select>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', color: 'var(--text-muted)' }}>
              <div style={rowStyle}>
                <span>Prefill speed</span>
                <span style={{ ...numStyle, color: 'var(--prefill)' }}>{presetA.prefillSpeed.toLocaleString()} tok/s</span>
              </div>
              {presetA.sourceUrl && <a href={presetA.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', fontWeight: 600 }}>View LocalMaxxing source run ↗</a>}
              <div style={rowStyle}>
                <span>Decode speed <em style={{ color: 'var(--text-subtle)', fontStyle: 'normal', fontSize: '0.72rem' }}>(per user)</em></span>
                <span style={{ ...numStyle, color: 'var(--decode)' }}>{Math.round(batchedPerUserDecodeA).toLocaleString()} tok/s</span>
              </div>
              {batchSize > 1 && (
                <div style={rowStyle}>
                  <span>Aggregate decode throughput</span>
                  <span style={{ ...numStyle, color: 'var(--agent)' }}>{Math.round(aggregateTokPerSecA).toLocaleString()} tok/s</span>
                </div>
              )}
              <div style={{ ...rowStyle, ...rowDivider }}>
                <span>TTFT (prompt)</span>
                <span style={{ ...numStyle, color: 'var(--prefill)' }}>{formatTime(ttftA)}</span>
              </div>
              <div style={rowStyle}>
                <span>Decode time</span>
                <span style={{ ...numStyle, color: 'var(--decode)' }}>{formatTime(decodeTimeA)}</span>
              </div>
              <div style={{ ...rowStyle, ...rowDivider, fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                <span>Total walltime</span>
                <span style={{ ...numStyle, color: 'var(--accent)' }}>{formatTime(totalTimeA)}</span>
              </div>
            </div>
          </div>

          {/* Hardware Config B */}
          <div className="panel-inset" style={{ borderLeft: '2px solid var(--border-strong)' }}>
            <div className="section-label" style={{ marginBottom: '8px' }}>
              System B · comparison
            </div>
            <select
              value={hardwareB}
              onChange={(e) => setHardwareB(e.target.value)}
              aria-label="System B hardware profile"
              style={{ width: '100%', marginBottom: '14px' }}
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
              ))}
            </select>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', color: 'var(--text-muted)' }}>
              <div style={rowStyle}>
                <span>Prefill speed</span>
                <span style={{ ...numStyle, color: 'var(--prefill)' }}>{presetB.prefillSpeed.toLocaleString()} tok/s</span>
              </div>
              {presetB.sourceUrl && <a href={presetB.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', fontWeight: 600 }}>View LocalMaxxing source run ↗</a>}
              <div style={rowStyle}>
                <span>Decode speed <em style={{ color: 'var(--text-subtle)', fontStyle: 'normal', fontSize: '0.72rem' }}>(per user)</em></span>
                <span style={{ ...numStyle, color: 'var(--decode)' }}>{Math.round(batchedPerUserDecodeB).toLocaleString()} tok/s</span>
              </div>
              {batchSize > 1 && (
                <div style={rowStyle}>
                  <span>Aggregate decode throughput</span>
                  <span style={{ ...numStyle, color: 'var(--agent)' }}>{Math.round(aggregateTokPerSecB).toLocaleString()} tok/s</span>
                </div>
              )}
              <div style={{ ...rowStyle, ...rowDivider }}>
                <span>TTFT (prompt)</span>
                <span style={{ ...numStyle, color: 'var(--prefill)' }}>{formatTime(ttftB)}</span>
              </div>
              <div style={rowStyle}>
                <span>Decode time</span>
                <span style={{ ...numStyle, color: 'var(--decode)' }}>{formatTime(decodeTimeB)}</span>
              </div>
              <div style={{ ...rowStyle, ...rowDivider, fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                <span>Total walltime</span>
                <span style={numStyle}>{formatTime(totalTimeB)}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Speedup Ratio Summary */}
        <div className="metric-grid" style={{ marginTop: '16px' }}>
          <div
            className="metric"
            style={{ borderLeftColor: speedupTotal >= 1 ? 'var(--decode)' : 'var(--danger)', textAlign: 'center' }}
          >
            <div className="metric-label">Overall walltime</div>
            <div className="metric-value" style={{ color: speedupTotal >= 1 ? 'var(--decode)' : 'var(--danger)', fontSize: '1.5rem' }}>
              {speedupTotal > 0 ? (speedupTotal >= 1 ? `${speedupTotal.toFixed(2)}x faster` : `${(1 / speedupTotal).toFixed(2)}x slower`) : '—'}
            </div>
            <div className="metric-sub">System A vs System B</div>
          </div>

          <div className="metric" style={{ borderLeftColor: 'var(--prefill)', textAlign: 'center' }}>
            <div className="metric-label">Prefill TTFT advantage</div>
            <div className="metric-value" style={{ color: 'var(--prefill)' }}>
              {speedupPrefill.toFixed(2)}x
            </div>
          </div>

          <div className="metric" style={{ borderLeftColor: 'var(--decode)', textAlign: 'center' }}>
            <div className="metric-label">Decode generation advantage</div>
            <div className="metric-value" style={{ color: 'var(--decode)' }}>
              {speedupDecode.toFixed(2)}x
            </div>
          </div>
        </div>

      </section>

    </div>
  );
}
