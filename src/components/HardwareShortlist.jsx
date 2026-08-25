import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ListFilter, ExternalLink, RotateCcw } from 'lucide-react';
import { readParam, readParamNum, writeParams } from '../utils/urlState';
import { quantizationMatches } from '../utils/hardwareShortlist';
import { formatTime } from '../utils/presets';
import { fetchHardwareShortlist, qualitySignals, qualitySummaryText } from '../utils/hardwareShortlist';

// Constraint-driven hardware shortlist ("find me hardware").
//
// The user states workload constraints — minimum acceptable decode tok/s at a
// given quantization, an optional model family, and a max VRAM budget — and we
// return a ranked shortlist of community-measured rigs. Ranking comes straight
// from GET /api/best (median decode per hardware×model group, outlier-resistant).
// Constraints are applied SERVER-SIDE (#496) via /api/best's own quant /
// minDecode / maxVramGb filters so the shortlist answers the same question the
// documented API does — filtering only the global top-50 client-side hid
// qualifying rigs ranked below 50 and starved the quant dropdown. An
// unconstrained top-50 is still fetched alongside to build the quantization
// vocabulary even while a quant filter narrows the constrained result set.
//
// Power draw and new-vs-used listing price are NOT yet tracked in the
// community run metadata (totalPowerWatts/hardwareCost are almost always null
// upstream), so those inputs are deliberately absent rather than fake-filtered.

import { fetchHardwareShortlist } from '../utils/hardwareShortlist';

const FETCH_DEBOUNCE_MS = 250;

function rigLabel(row) {
  const hwClass = (row.hwClass || '').toLowerCase();
  if (hwClass === 'unified' && row.chip) {
    return `${row.chip}${row.unifiedMemoryGb ? ` ${row.unifiedMemoryGb}GB` : ''}`;
  }
  if (row.gpu) {
    const count = row.gpuCount || 1;
    return `${count > 1 ? `${count}× ` : ''}${row.gpu}${row.vramGb ? ` ${row.vramGb}GB` : ''}`;
  }
  return row.cpu || row.hardware || 'Unknown system';
}

export default function HardwareShortlist() {
  const [minDecode, setMinDecode] = useState(() => {
    const v = readParamNum('sd', NaN);
    return Number.isFinite(v) && v > 0 ? v : '';
  });
  const [maxVram, setMaxVram] = useState(() => {
    const v = readParamNum('sv', NaN);
    return Number.isFinite(v) && v > 0 ? v : '';
  });
  const [model, setModel] = useState(() => readParam('sm') || '');
  const [quant, setQuant] = useState(() => readParam('sq') || '');

  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);       // ranked groups currently displayed
  const [optionRows, setOptionRows] = useState([]); // unconstrained top-50 (quant vocabulary)
  const [matchedRuns, setMatchedRuns] = useState(0);
  const abortRef = useRef(null);

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({ sd: minDecode, sv: maxVram, sm: model, sq: quant });
  }, [minDecode, maxVram, model, quant]);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        setStatus('loading');
        setError(null);
        // Issue #832: send ALL constraints to /api/best (quant, minDecode,
        // maxVramGb via fetchHardwareShortlist) so every displayed median is
        // the group's median AT the selected quant — filtering the global
        // top-50 client-side showed all-quant medians next to a quant label
        // and could never surface qualifying rigs outside that top 50.
        const data = await fetchHardwareShortlist({
          minDecode: minDecode === '' ? null : Number(minDecode),
          quant: quant.trim(),
          maxVramGb: maxVram === '' ? null : Number(maxVram),
          model: model.trim()
        }, controller.signal);
        setRows(data.results || []);
        setMatchedRuns(data.matchedRuns || 0);
        setStatus('ready');
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(String(err.message || err));
        setStatus('error');
      }
    }, FETCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [model, minDecode, maxVram, quant]);

  // Distinct quantizations seen in the corpus, most common first.
  // Built from the UNCONSTRAINED top-50 so selecting one option doesn't
  // collapse the rest out of the dropdown (#496, consequence 3).
  const quantOptions = useMemo(() => {
    const counts = new Map();
    for (const row of optionRows) {
      const q = row.quantization || 'Unknown';
      counts.set(q, (counts.get(q) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([q]) => q);
  }, [optionRows]);

  // Issue #832: constraints are applied server-side now (or by the client-side
  // fallback aggregator inside fetchHardwareShortlist), so the ranked rows ARE
  // the shortlist — no second client-side filter on top.
  const shortlist = rows;

  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.82rem' };
  const numStyle = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 };

  return (
    <div className="stack">

      <section className="panel" aria-label="Hardware shortlist">
        <h2 className="panel-title" style={{ marginBottom: '14px' }} tabIndex={-1} data-panel-heading>
          <ListFilter size={16} />
          <span>Find Me Hardware</span>
        </h2>

        <p className="hint-text" style={{ marginBottom: '14px' }}>
          State your workload constraints and get a ranked shortlist of real,
          community-verified rigs from LocalMaxxing single-stream benchmark runs —
          each linking to its source run. Ranked by measured{' '}
          <strong>median decode tok/s</strong>, so one lucky run can&apos;t top the list.
        </p>

        {/* Workload constraints */}
        <div className="grid-auto" style={{ '--grid-min': '13.75rem', marginBottom: '16px' }}>
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Min decode speed</span>
              <span className="field-value" style={{ color: 'var(--decode)' }}>
                {minDecode === '' ? 'any' : `≥ ${Number(minDecode).toLocaleString()} tok/s`}
              </span>
            </div>
            <input
              type="number"
              min="0"
              placeholder="No minimum"
              value={minDecode}
              aria-label="Minimum acceptable decode tokens per second"
              onChange={(e) => setMinDecode(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Max VRAM budget</span>
              <span className="field-value" style={{ color: 'var(--prefill)' }}>
                {maxVram === '' ? 'any' : `≤ ${Number(maxVram)} GB`}
              </span>
            </div>
            <input
              type="number"
              min="0"
              placeholder="No budget"
              value={maxVram}
              aria-label="Maximum VRAM budget in gigabytes"
              onChange={(e) => setMaxVram(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Model family</span>
            </div>
            <input
              type="text"
              placeholder="Any model (e.g. llama, qwen)"
              value={model}
              aria-label="Restrict to model family substring"
              onChange={(e) => setModel(e.target.value)}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Quantization</span>
            </div>
            <select
              value={quant}
              aria-label="Exact quantization match"
              onChange={(e) => setQuant(e.target.value)}
            >
              <option value="">Any quant</option>
              {quantOptions.map(q => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Results */}
        {status === 'loading' && (
          <div className="panel-inset" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Querying community benchmark corpus…
          </div>
        )}

        {status === 'error' && (
          <div className="panel-inset" style={{ borderColor: 'var(--danger)', fontSize: '0.82rem', color: 'var(--danger)' }}>
            Couldn&apos;t reach /api/best ({error}). The ranking API needs the serverless
            backend — on Vercel it ships with the deploy; locally run the Vite dev server
            which mounts the same handlers.
          </div>
        )}

        {status === 'ready' && shortlist.length === 0 && (
          <div className="panel-inset" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            No community-verified rig meets these constraints{matchedRuns > 0 ? ` (${matchedRuns} runs scanned)` : ''}.
            Relax the minimum decode speed, raise the VRAM budget, or pick a different quant.
          </div>
        )}

        {status === 'ready' && shortlist.length > 0 && (
          <>
            <div className="panel-inset" style={{ marginBottom: '12px', borderColor: 'var(--prefill-border)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: '0.76rem', fontWeight: 600 }}>
              {shortlist.length} rig{shortlist.length === 1 ? '' : 's'} match · ranked by median decode tok/s · medians are outlier-resistant, runsInGroup shows sample size
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {shortlist.map((row, i) => {
                const q = qualitySignals(row);
                const qualityLine = qualitySummaryText(q);
                return (
                <div key={`${row.hardwareKey}|${row.modelFamily}|${row.quantization}`} className="panel-inset">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                    <div>
                      <span style={{ color: 'var(--text-subtle)', fontSize: '0.72rem', marginRight: '8px' }}>#{i + 1}</span>
                      <strong style={{ fontSize: '0.92rem' }}>{rigLabel(row)}</strong>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginLeft: '8px' }}>
                        {row.modelFamily}{row.exampleModel ? ` · e.g. ${row.exampleModel}` : ''}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ ...numStyle, color: 'var(--decode)', fontSize: '1.15rem' }}>
                        {Math.round(row.medianDecodeTokPerSec).toLocaleString()}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}> tok/s median decode</span>
                      {/* #845: the 95% bootstrap CI that defines which adjacent
                          ranks are statistical ties — previously stripped. */}
                      {row.medianDecodeCi95 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                          95% CI {row.medianDecodeCi95.lo?.toLocaleString()}–{row.medianDecodeCi95.hi?.toLocaleString()} tok/s · overlap ≈ tie
                        </div>
                      )}
                    </div>
                  </div>

                  {qualityLine && (
                    <div data-quality-signals style={{
                      marginTop: '7px', fontSize: '0.72rem', lineHeight: 1.5,
                      color: (q.flagged || q.grade === 'low') ? 'var(--warn)' : 'var(--text-muted)'
                    }}>
                      {qualityLine}
                    </div>
                  )}

                  <div style={{ ...rowStyle, marginTop: '9px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                    <span>Prefill (median)</span>
                    <span style={{ ...numStyle, color: 'var(--prefill)' }}>
                      {Math.round(row.medianPrefillTokPerSec || 0).toLocaleString()} tok/s
                    </span>
                  </div>
                  <div style={rowStyle}>
                    <span>Best measured decode</span>
                    <span style={{ ...numStyle, color: 'var(--agent)' }}>
                      {Math.round(row.bestDecodeTokPerSec || 0).toLocaleString()} tok/s
                    </span>
                  </div>
                  <div style={rowStyle}>
                    <span>Engine · quant</span>
                    <span>{row.engine || '—'} · {row.quantization || '—'}</span>
                  </div>
                  {/* #845: decision-metric rows previously stripped from the
                      DOM — workload projections, pricing, power, and the
                      ready-made explain string. Each renders only when the
                      API row actually carries the field. */}
                  {row.projectedWalltimeSeconds != null && (
                    <div style={rowStyle}>
                      <span>Projected walltime (workload)</span>
                      <span style={{ ...numStyle }}>{formatTime(row.projectedWalltimeSeconds)}</span>
                    </div>
                  )}
                  {row.ttftSeconds != null && (
                    <div style={rowStyle}>
                      <span>TTFT (projected)</span>
                      <span style={{ ...numStyle }}>{formatTime(row.ttftSeconds)}</span>
                    </div>
                  )}
                  {row.pricing?.estimateUsd != null && (
                    <div style={rowStyle}>
                      <span>Street-price estimate</span>
                      <span style={{ ...numStyle }}>
                        ≈${Math.round(row.pricing.estimateUsd).toLocaleString()}
                        {row.pricing.lowUsd != null && row.pricing.highUsd != null
                          ? ` (${Math.round(row.pricing.lowUsd).toLocaleString()}–${Math.round(row.pricing.highUsd).toLocaleString()})`
                          : ''}
                      </span>
                    </div>
                  )}
                  {row.power?.loadWatts != null && (
                    <div style={rowStyle}>
                      <span>Power draw</span>
                      <span style={{ ...numStyle }}>
                        ~{Math.round(row.power.loadWatts)} W load
                        {row.power.totalTdpWatts != null ? ` · ${Math.round(row.power.totalTdpWatts)} W TDP` : ''}
                      </span>
                    </div>
                  )}
                  {row.explain && (
                    <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: '0.74rem' }}>{row.explain}</p>
                  )}
                  <div style={{ ...rowStyle, alignItems: 'center' }}>
                    <span>Source runs in group</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={numStyle}>{row.runsInGroup}</span>
                      {row.source && (
                        <a href={row.source} target="_blank" rel="noreferrer" className="source-link" style={{ fontSize: '0.72rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          View source run <ExternalLink size={11} />
                        </a>
                      )}
                    </span>
                  </div>
                </div>
                );
              })}
            </div>
          </>
        )}

        <p className="hint-text" style={{ marginTop: '14px' }}>
          Agents: the same ranking is available as JSON —{' '}
          <a href="/api/best">/api/best</a> · <a href="/api/localmaxxing">/api/localmaxxing</a>.
          Power draw and new-vs-used pricing aren&apos;t tracked in the community dataset
          yet, so they can&apos;t constrain this shortlist.
        </p>

        {(minDecode !== '' || maxVram !== '' || quant || model) && status !== 'loading' && (
          <button
            className="btn"
            onClick={() => { setMinDecode(''); setMaxVram(''); setQuant(''); setModel(''); }}
            title="Clear all constraints"
          >
            <RotateCcw size={14} />
            Clear constraints
          </button>
        )}

      </section>

    </div>
  );
}
