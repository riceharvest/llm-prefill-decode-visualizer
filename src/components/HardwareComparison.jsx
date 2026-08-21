import React, { useRef, useState, useEffect } from 'react';
import { HARDWARE_PRESETS, formatTime, formatTokens } from '../utils/presets';
import { BarChart3, Users, PlugZap } from 'lucide-react';
import { readParam, readParamNum, readParamBool, writeParams } from '../utils/urlState';
import { methodologyMismatch } from '../utils/localMaxxing';

// Typical whole-rig wattage under inference load (GPU + rest-of-system overhead).
// Used as the default for the TCO section; the user can always override it.
const DEFAULT_WATTS = {
  rtx4090_exl2: 450,
  dual_rtx3090: 700,
  rtx3090_llamacpp: 350,
  mac_ultra: 180,
  rtx3060_entry: 220,
  h100: 700,
  rpi5: 12,
  custom: 400
};
const defaultWattsFor = (id) => DEFAULT_WATTS[id] ?? 400;

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
  // Optional pricing: $ per 1M tokens (input/output) per system. Leave blank
  // for local hardware where marginal cost is electricity, not tokens.
  const [priceAIn, setPriceAIn] = useState(() => readParam('piA') ?? '');
  const [priceAOut, setPriceAOut] = useState(() => readParam('poA') ?? '');
  const [priceBIn, setPriceBIn] = useState(() => readParam('piB') ?? '');
  const [priceBOut, setPriceBOut] = useState(() => readParam('poB') ?? '');

  // TCO: local electricity vs cloud pricing. Marginal cost of a local rig is
  // watts-under-load × $/kWh; cloud cost is a single blended $/M token input.
  const [tcoHw, setTcoHw] = useState(() => readParam('tcoHw') || 'rtx4090_exl2');
  const [tcoWatts, setTcoWatts] = useState(() => readParam('tcoW') ?? String(defaultWattsFor(readParam('tcoHw') || 'rtx4090_exl2')));
  const [tcoKwh, setTcoKwh] = useState(() => readParam('tcoKwh') ?? '0.30');
  const [tcoCloud, setTcoCloud] = useState(() => readParam('tcoCloud') ?? '');
  const [tcoCapex, setTcoCapex] = useState(() => readParam('tcoCapex') ?? '2500');
  const [tcoAmortMonths, setTcoAmortMonths] = useState(() => Math.max(1, Math.round(readParamNum('tcoAmort', 24))));

  const handleTcoHwChange = (id) => {
    setTcoHw(id);
    setTcoWatts(String(defaultWattsFor(id)));
  };

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({
      hwA: hardwareA, hwB: hardwareB, cp: testPromptTokens, co: testOutputTokens,
      batch: batchSize === 1 ? '' : batchSize,
      piA: priceAIn, poA: priceAOut, piB: priceBIn, poB: priceBOut,
      tcoHw, tcoW: tcoWatts, tcoKwh, tcoCloud, tcoCapex, tcoAmort: tcoAmortMonths
    });
  }, [hardwareA, hardwareB, testPromptTokens, testOutputTokens, batchSize, priceAIn, priceAOut, priceBIn, priceBOut, tcoHw, tcoWatts, tcoKwh, tcoCloud, tcoCapex, tcoAmortMonths]);

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

  // Cost per request: (prompt/1M × $in) + (output/1M × $out). Blank prices → null.
  const costPerRequest = (pIn, pOut) => {
    const inP = parseFloat(pIn), outP = parseFloat(pOut);
    if (!Number.isFinite(inP) && !Number.isFinite(outP)) return null;
    return (safeCp / 1e6) * (Number.isFinite(inP) ? inP : 0)
         + (safeCo / 1e6) * (Number.isFinite(outP) ? outP : 0);
  };
  const costA = costPerRequest(priceAIn, priceAOut);
  const costB = costPerRequest(priceBIn, priceBOut);

  // ---- TCO: electricity vs cloud -----------------------------------------
  // Marginal local cost is electricity only: (W/1000 × $/kWh) ÷ aggregate
  // decode tok/s → $ per token. The rig draws power whenever it is on, so
  // monthly electricity assumes 24/7 load. Break-even answers: how many
  // tokens/month make cloud spend equal owning the rig (capex amortized +
  // always-on electricity)? Below that volume, renting wins.
  const tcoPreset = presets.find(p => p.id === tcoHw) || presets[0] || HARDWARE_PRESETS[0];
  const tcoWattsNum = parseFloat(tcoWatts);
  const tcoKwhNum = parseFloat(tcoKwh);
  const tcoCloudNum = parseFloat(tcoCloud);
  const tcoCapexNum = parseFloat(tcoCapex);
  const tcoValid = Number.isFinite(tcoWattsNum) && tcoWattsNum > 0 && tcoPreset.decodeSpeed > 0;

  const tcoThroughput = tcoValid
    ? tcoPreset.decodeSpeed * Math.pow(Math.max(1, batchSize), 0.75) // aggregate tok/s
    : 0;
  // kW × $/kWh is dollars per hour of full-load runtime.
  const tcoCostPerHour = tcoValid ? (tcoWattsNum / 1000) * (Number.isFinite(tcoKwhNum) ? tcoKwhNum : 0) : 0;
  const tcoLocalPerMtok = tcoThroughput > 0 ? ((tcoCostPerHour / 3600) / tcoThroughput) * 1e6 : null;
  const tcoMonthlyElectricity = tcoCostPerHour * 24 * 30; // 720 h month at constant load
  const tcoMonthlyCapex = Number.isFinite(tcoCapexNum) ? tcoCapexNum / tcoAmortMonths : 0;
  // Cloud must beat the marginal electricity cost for any break-even to exist.
  const tcoBreakEven = (tcoLocalPerMtok !== null && Number.isFinite(tcoCloudNum) && tcoCloudNum > tcoLocalPerMtok)
    ? ((tcoMonthlyCapex + tcoMonthlyElectricity) * 1e6) / (tcoCloudNum - tcoLocalPerMtok)
    : null;

  const speedupTotal = totalTimeA > 0 ? totalTimeB / totalTimeA : 0;
  const speedupPrefill = ttftA > 0 ? ttftB / ttftA : 0;
  const speedupDecode = decodeTimeA > 0 ? decodeTimeB / decodeTimeA : 0;

  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.82rem' };
  const rowDivider = { paddingTop: '8px', borderTop: '1px solid var(--border)' };
  const numStyle = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 };

  // Freshness tiers match the API contract (issue #38): fresh <90d, aging <1y,
  // stale ≥1y. Measured presets carry the source run's date + engine version.
  const tierColors = { fresh: 'var(--decode)', aging: 'var(--agent)', stale: 'var(--danger)' };
  const measuredLabel = preset => {
    if (!preset?.localMaxxing) return null;
    if (!preset.measuredAt) return 'date unknown';
    const version = preset.engineVersion ? ` · ${preset.run?.engine?.engineName || ''} ${preset.engineVersion}` : '';
    return `${preset.measuredAt.slice(0, 10)} · ${preset.ageDays}d (${preset.staleness})${version}`;
  };
  const mismatchReasons = methodologyMismatch(presetA, presetB);

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
              {measuredLabel(presetA) && (
                <div style={rowStyle}>
                  <span>Measured</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: tierColors[presetA.staleness] || 'var(--text-muted)' }}>
                    {measuredLabel(presetA)}
                  </span>
                </div>
              )}
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
              {/* Optional per-request cost */}
              <div style={{ ...rowStyle, marginTop: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem' }}>$ / 1M tok (in · out)</span>
                <span style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="in"
                    value={priceAIn}
                    aria-label="System A input price per million tokens"
                    onChange={(e) => setPriceAIn(e.target.value)}
                    style={{ width: '58px', padding: '3px 5px', fontSize: '0.72rem' }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="out"
                    value={priceAOut}
                    aria-label="System A output price per million tokens"
                    onChange={(e) => setPriceAOut(e.target.value)}
                    style={{ width: '58px', padding: '3px 5px', fontSize: '0.72rem' }}
                  />
                </span>
              </div>
              {costA !== null && (
                <div style={rowStyle}>
                  <span>Cost per request</span>
                  <span style={{ ...numStyle, color: 'var(--agent)' }}>${costA.toFixed(4)}</span>
                </div>
              )}
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
              {measuredLabel(presetB) && (
                <div style={rowStyle}>
                  <span>Measured</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: tierColors[presetB.staleness] || 'var(--text-muted)' }}>
                    {measuredLabel(presetB)}
                  </span>
                </div>
              )}
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
              {/* Optional per-request cost */}
              <div style={{ ...rowStyle, marginTop: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem' }}>$ / 1M tok (in · out)</span>
                <span style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="in"
                    value={priceBIn}
                    aria-label="System B input price per million tokens"
                    onChange={(e) => setPriceBIn(e.target.value)}
                    style={{ width: '58px', padding: '3px 5px', fontSize: '0.72rem' }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="out"
                    value={priceBOut}
                    aria-label="System B output price per million tokens"
                    onChange={(e) => setPriceBOut(e.target.value)}
                    style={{ width: '58px', padding: '3px 5px', fontSize: '0.72rem' }}
                  />
                </span>
              </div>
              {costB !== null && (
                <div style={rowStyle}>
                  <span>Cost per request</span>
                  <span style={{ ...numStyle, color: 'var(--agent)' }}>${costB.toFixed(4)}</span>
                </div>
              )}
            </div>
          </div>

        </div>

        {mismatchReasons.length > 0 && (
          <div
            className="panel-inset"
            role="note"
            aria-label="Methodology mismatch warning"
            style={{ marginTop: '16px', borderColor: 'var(--danger)', color: 'var(--text-muted)', fontSize: '0.76rem' }}
          >
            <strong style={{ color: 'var(--danger)' }}>Methodology mismatch:</strong>{' '}
            System A and System B differ in {mismatchReasons.join('; ')}. The speedup ratios below compare numbers that may not be directly comparable.
          </div>
        )}

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

      {/* TCO: Local Electricity vs Cloud */}
      <section className="panel" aria-label="Total cost of ownership electricity versus cloud">
        <h2 className="panel-title" style={{ marginBottom: '14px' }}>
          <PlugZap size={16} />
          <span>TCO · Local Electricity vs Cloud</span>
        </h2>

        <div className="grid-auto" style={{ '--grid-min': '240px', marginBottom: '16px' }}>
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Local rig</span>
            </div>
            <select
              value={tcoHw}
              onChange={(e) => handleTcoHwChange(e.target.value)}
              aria-label="TCO local hardware profile"
              style={{ width: '100%' }}
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
              ))}
            </select>
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Wattage under load</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{tcoWatts || '—'} W</span>
            </div>
            <input
              type="number"
              min="1"
              step="10"
              value={tcoWatts}
              aria-label="Rig wattage under inference load"
              onChange={(e) => setTcoWatts(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Electricity price</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>${tcoKwh || '—'}/kWh</span>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              value={tcoKwh}
              aria-label="Local electricity price per kilowatt-hour"
              onChange={(e) => setTcoKwh(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Cloud price</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>${tcoCloud || '—'}/Mtok</span>
            </div>
            <input
              type="number"
              min="0"
              step="0.10"
              placeholder="blended $ / 1M tok"
              value={tcoCloud}
              aria-label="Cloud price per million tokens"
              onChange={(e) => setTcoCloud(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Rig cost</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>${tcoCapex || '—'}</span>
            </div>
            <input
              type="number"
              min="0"
              step="100"
              value={tcoCapex}
              aria-label="Local rig purchase price"
              onChange={(e) => setTcoCapex(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Amortize over</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{tcoAmortMonths} mo</span>
            </div>
            <input
              type="number"
              min="1"
              step="1"
              value={tcoAmortMonths}
              aria-label="Amortization period in months"
              onChange={(e) => setTcoAmortMonths(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {tcoValid ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', color: 'var(--text-muted)', maxWidth: '480px' }}>
              <div style={rowStyle}>
                <span>Aggregate decode throughput</span>
                <span style={{ ...numStyle, color: 'var(--decode)' }}>{Math.round(tcoThroughput).toLocaleString()} tok/s</span>
              </div>
              <div style={rowStyle}>
                <span>Local marginal cost (electricity only)</span>
                <span style={{ ...numStyle, color: 'var(--prefill)' }}>
                  {tcoLocalPerMtok !== null ? `$${tcoLocalPerMtok < 0.01 ? tcoLocalPerMtok.toFixed(4) : tcoLocalPerMtok.toFixed(2)} / Mtok` : '—'}
                </span>
              </div>
              {Number.isFinite(tcoCloudNum) && tcoLocalPerMtok !== null && (
                <div style={rowStyle}>
                  <span>Cloud cost</span>
                  <span style={{ ...numStyle, color: 'var(--agent)' }}>${tcoCloudNum.toFixed(2)} / Mtok</span>
                </div>
              )}
              <div style={{ ...rowStyle, ...rowDivider }}>
                <span>Always-on electricity (24/7 load)</span>
                <span style={numStyle}>${tcoMonthlyElectricity.toFixed(2)} / mo</span>
              </div>
              {tcoMonthlyCapex > 0 && (
                <div style={rowStyle}>
                  <span>Rig amortized over {tcoAmortMonths} mo</span>
                  <span style={numStyle}>${tcoMonthlyCapex.toFixed(2)} / mo</span>
                </div>
              )}
            </div>

            <div className="metric-grid" style={{ marginTop: '16px' }}>
              <div className="metric" style={{ borderLeftColor: tcoBreakEven !== null ? 'var(--decode)' : 'var(--prefill)', textAlign: 'center' }}>
                <div className="metric-label">Break-even volume</div>
                <div className="metric-value" style={{ color: tcoBreakEven !== null ? 'var(--decode)' : 'var(--prefill)', fontSize: '1.5rem' }}>
                  {tcoBreakEven !== null
                    ? `${formatTokens(Math.round(tcoBreakEven))} tok/mo`
                    : (Number.isFinite(tcoCloudNum) ? 'Cloud wins at any volume' : '—')}
                </div>
                <div className="metric-sub">
                  {tcoBreakEven !== null
                    ? 'above this, the local rig is cheaper than cloud'
                    : (Number.isFinite(tcoCloudNum) ? 'cloud $/Mtok is at or below the electricity cost per Mtok' : 'enter a cloud $/Mtok to compute')}
                </div>
              </div>

              {tcoBreakEven !== null && (
                <div className="metric" style={{ borderLeftColor: 'var(--agent)', textAlign: 'center' }}>
                  <div className="metric-label">Cloud spend at break-even</div>
                  <div className="metric-value" style={{ color: 'var(--agent)' }}>
                    ${(tcoBreakEven / 1e6 * tcoCloudNum).toFixed(0)}/mo
                  </div>
                  <div className="metric-sub">monthly cloud bill the rig must beat</div>
                </div>
              )}
            </div>

            <p className="hint-text" style={{ marginTop: '12px' }}>
              Marginal local cost = (watts ÷ 1000 × $/kWh) ÷ aggregate decode tok/s. The rig draws power whenever it is on,
              so monthly electricity assumes 24/7 load; break-even adds the rig price amortized over the chosen period.
              Idle draw, cooling, and internet are not modeled.
            </p>
          </>
        ) : (
          <p className="hint-text">Enter a positive wattage to compute the local rig's electricity cost per million tokens.</p>
        )}
      </section>

    </div>
  );
}
