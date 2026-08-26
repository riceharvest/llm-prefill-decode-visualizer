import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Search, ExternalLink } from 'lucide-react';
import { readParam, writeParams } from '../utils/urlState';
import {
  buildQuantRows,
  qualityNoteKey,
  weightsVramGb
} from '../utils/quantMatrix';
import { normalizeModelId } from '../../api/_normalize.js';
import { t } from '../i18n/strings';
import { collectGroupedItems, dedupeByKey } from '../utils/benchmarksIndex';

// Quantization tradeoff matrix (issue #47).
//
// One model family, one table: every quantization the community has measured
// (FP16/FP8/GPTQ/GGUF Q4_K_M…) side by side with measured decode tok/s from
// GET /api/benchmarks?model=<family>&groupBy=quant. The API cohorts by
// hardware×quant (same-engine), so each row here aggregates the per-rig groups
// that share a quantization tag: median-of-medians decode across rigs plus the
// single best measured run. Clicking a row loads that quant's best measured
// speeds into the simulator — answering "can I drop to Q4 and still hit my
// tok/s on this card?" without opening five benchmark threads.
//
// VRAM footprint and the quality-proxy note are clearly-labeled estimates:
// weights-only GB from approximate bits-per-weight × parameter count parsed
// out of the family key; quality tiers are community rules of thumb, not
// benchmark output. The pure row-building logic lives in utils/quantMatrix.js
// (with tests); this file is fetch + render.

const FETCH_DEBOUNCE_MS = 250;

// Whole days since the run was measured; null when the date is missing/invalid.
function ageDaysFrom(createdAt, now = new Date()) {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86400000));
}

export default function QuantTradeoffMatrix({ localMaxxingContext, onApplySpeeds }) {
  // Committed family drives the API query; the text input is free-typed and
  // loaded explicitly (Enter or the search button), matching the preset picker.
  const [familyInput, setFamilyInput] = useState(() => readParam('qtm') || '');
  const [family, setFamily] = useState(() => readParam('qtm') || '');
  const [families, setFamilies] = useState([]);
  const [familiesTruncated, setFamiliesTruncated] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState(null);
  const [groups, setGroups] = useState([]);
  const [matchedRuns, setMatchedRuns] = useState(0);
  const [appliedQuant, setAppliedQuant] = useState(null);
  const abortRef = useRef(null);
  // The context-derived default is applied once; afterwards the user's manual
  // choice always wins, even when the picker selection changes again.
  const defaultApplied = useRef(false);

  useEffect(() => {
    writeParams({ qtm: family });
  }, [family]);

  // Family index for the datalist: grouped call(s), following the documented
  // cursor pagination until has_more=false (#772 — a single ?limit=200 page
  // silently dropped 38 of 238 model families).
  useEffect(() => {
    const controller = new AbortController();
    const fetchPage = async (query) => {
      const res = await fetch(`/api/benchmarks?${query}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`/api/benchmarks returned ${res.status}`);
      return res.json();
    };
    collectGroupedItems(fetchPage, { groupBy: 'model', limit: 200 })
      .then(({ items, truncated }) => {
        setFamiliesTruncated(truncated);
        const list = dedupeByKey(items)
          .map(item => ({ family: item.key, runs: item.runs || 0 }))
          .sort((a, b) => b.runs - a.runs);
        setFamilies(list);
        return list;
      })
      .then(list => {
        if (defaultApplied.current || !list.length) return;
        // Seed with the LocalMaxxing picker's model when present, else the
        // most-measured family, so the matrix lands populated instead of blank.
        const ctxFamily = localMaxxingContext.modelId ? normalizeModelId(localMaxxingContext.modelId) : '';
        const seed = ctxFamily && list.some(f => f.family === ctxFamily)
          ? ctxFamily
          : list[0].family;
        defaultApplied.current = true;
        setFamily(seed);
        setFamilyInput(seed);
      })
      .catch(err => {
        if (err.name !== 'AbortError') setError(String(err.message || err));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Matrix data: re-queried whenever the committed family changes.
  useEffect(() => {
    abortRef.current?.abort();
    if (!family.trim()) {
      setGroups([]);
      setStatus('idle');
      return undefined;
    }
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        setStatus('loading');
        setError(null);
        const params = new URLSearchParams({ model: family.trim(), groupBy: 'quant', limit: '200' });
        const res = await fetch(`/api/benchmarks?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`/api/benchmarks returned ${res.status}`);
        const data = await res.json();
        setGroups(data.items || []);
        setMatchedRuns(data.matchedRuns || 0);
        setAppliedQuant(null);
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
  }, [family]);

  const rows = useMemo(() => buildQuantRows(groups).map(row => ({
    ...row,
    weightsVramGb: weightsVramGb(family, row.bpw)
  })), [groups, family]);

  const loadFamily = () => {
    const value = familyInput.trim();
    if (value) setFamily(value);
  };

  const handleLoadRow = (row) => {
    const run = row.best?.bestRun;
    if (!run || !onApplySpeeds) return;
    onApplySpeeds(run.prefillTokPerSec, run.decodeTokPerSec);
    setAppliedQuant(row.quant);
  };

  const tierColors = { fresh: 'var(--decode)', aging: 'var(--agent)', stale: 'var(--danger)' };

  return (
    <section className="panel" aria-label={t('quant.panelAria')}>
      <h2 className="panel-title" style={{ marginBottom: '14px' }}>
        <Layers size={16} />
        <span>{t('quant.panelTitle')}</span>
      </h2>

      <p className="hint-text" style={{ marginBottom: '14px' }}>{t('quant.intro')}</p>

      {/* Model family selector */}
      <div className="grid-auto" style={{ '--grid-min': '16.25rem', marginBottom: '16px' }}>
        <div className="panel-inset field">
          <div className="field-head">
            <span className="field-label">{t('quant.familyLabel')}</span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              list="quant-matrix-families"
              value={familyInput}
              onChange={(e) => setFamilyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadFamily(); }}
              placeholder={t('quant.familyPlaceholder')}
              aria-label={t('quant.familyAria')}
              style={{ minWidth: 0, flex: 1 }}
            />
            <button
              onClick={loadFamily}
              title={t('quant.loadTitle')}
              aria-label={t('quant.loadAria')}
              className="btn btn-icon"
              style={{ minHeight: '34px', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Search size={15} />
            </button>
          </div>
          <datalist id="quant-matrix-families">
            {families.map(f => (
              <option key={f.family} value={f.family}>{f.runs} {t('quant.runsCountSuffix')}</option>
            ))}
          </datalist>
          {familiesTruncated && (
            <p role="status" className="hint-text" style={{ margin: '6px 0 0', fontSize: '0.68rem' }}>
              Family list hit the pagination guard before the corpus was exhausted — free-type any family name to query it anyway.
            </p>
          )}
        </div>
      </div>

      {status === 'loading' && (
        <div className="panel-inset" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          {t('quant.loading')}
        </div>
      )}

      {status === 'error' && (
        <div className="panel-inset" style={{ borderColor: 'var(--danger)', fontSize: '0.82rem', color: 'var(--danger)' }}>
          {t('quant.errorPrefix')} {error}
        </div>
      )}

      {status === 'ready' && rows.length === 0 && (
        <div className="panel-inset" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          {t('quant.noRuns')}
        </div>
      )}

      {status === 'ready' && rows.length > 0 && (
        <>
          <div className="panel-inset" style={{ marginBottom: '12px', borderColor: 'var(--prefill-border)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: '0.76rem', fontWeight: 600 }}>
            {t('quant.banner', { family, rows: rows.length, runs: matchedRuns, rowsPlural: rows.length === 1 ? '' : 's' })}
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('quant.thQuant')}</th>
                  <th scope="col">{t('quant.thBits')}</th>
                  <th scope="col">{t('quant.thRigs')}</th>
                  <th scope="col">{t('quant.thMedianDecode')}</th>
                  <th scope="col">{t('quant.thBestMeasured')}</th>
                  <th scope="col">{t('quant.thWeightsVram')}</th>
                  <th scope="col">{t('quant.thQuality')}</th>
                  <th scope="col">{t('quant.thLoad')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const run = row.best?.bestRun;
                  // Freshness lives on the cohort (groupFreshness), not on the
                  // flattened bestRun; tier colors match HardwareComparison.
                  const freshness = row.best?.freshness?.staleness;
                  return (
                    <tr
                      key={row.quant}
                      className={appliedQuant === row.quant ? 'row-active' : ''}
                      onClick={() => handleLoadRow(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleLoadRow(row);
                        }
                      }}
                      tabIndex={onApplySpeeds ? 0 : undefined}
                      aria-label={onApplySpeeds ? `${t('quant.loadIntoSim')}: ${row.quant}` : undefined}
                      style={{ cursor: onApplySpeeds ? 'pointer' : 'default' }}
                    >
                      <td style={{ fontWeight: 700 }}>
                        {row.quant}
                        {row.mixedEngines && (
                          <span title={t('quant.mixedEnginesTitle')} style={{ color: 'var(--agent)', marginLeft: '6px', fontWeight: 400 }}>*</span>
                        )}
                      </td>
                      <td className="num" style={{ color: 'var(--text-muted)' }}>
                        {row.bpwAssumed ? `~${row.bpw}?` : row.bpw}
                      </td>
                      <td className="num">{row.rigs} × {row.runs}</td>
                      <td className="num" style={{ color: 'var(--decode)', fontWeight: 600 }}>
                        {row.medianDecode.toLocaleString()} tok/s
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', fontWeight: 400 }}>
                          {row.ciLabel || ''}
                        </div>
                      </td>
                      <td className="num">
                        {Math.round(run?.decodeTokPerSec || 0).toLocaleString()} tok/s
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', fontWeight: 400 }}>
                          {run ? `${run.hardware}${run.engine ? ` · ${run.engine}${run.engineVersion ? ` ${run.engineVersion}` : ''}` : ''}` : ''}
                          {freshness && freshness !== 'unknown' && ageDaysFrom(run?.createdAt) !== null && (
                            <span style={{ color: tierColors[freshness], marginLeft: '5px' }}>{ageDaysFrom(run?.createdAt)}d</span>
                          )}
                        </div>
                      </td>
                      <td className="num" title={t('quant.vramTitle')}>
                        {row.weightsVramGb !== null ? `≈ ${row.weightsVramGb.toFixed(1)} GB` : '—'}
                      </td>
                      <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t(qualityNoteKey(row.bpw))}</td>
                      <td>
                        <button
                          className="btn"
                          onClick={(e) => { e.stopPropagation(); handleLoadRow(row); }}
                          disabled={!onApplySpeeds}
                          aria-label={`${appliedQuant === row.quant ? t('quant.loaded') : t('quant.loadIntoSim')}: ${row.quant}`}
                          style={{ padding: '3px 10px', fontSize: '0.7rem', whiteSpace: 'nowrap' }}
                        >
                          {appliedQuant === row.quant ? t('quant.loaded') : t('quant.loadIntoSim')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="hint-text" style={{ marginTop: '12px' }}>
            {t('quant.legend')}{' '}
            {rows.some(r => r.best?.bestRun?.source) && (
              <a
                href={rows.find(r => r.best?.bestRun?.source)?.best.bestRun.source}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}
              >
                {t('quant.viewSource')} <ExternalLink size={11} />
              </a>
            )}
          </p>

          {appliedQuant && (
            <div className="panel-inset" role="status" style={{ marginTop: '10px', borderColor: 'var(--decode-border)', background: 'var(--decode-dim)', color: 'var(--decode)', fontSize: '0.76rem', fontWeight: 600 }}>
              {t('quant.appliedBanner', { quant: appliedQuant })}
            </div>
          )}
        </>
      )}

      <p className="hint-text" style={{ marginTop: '14px' }}>
        {t('quant.agentsNote')} <a href={`/api/benchmarks?model=${encodeURIComponent(family)}&groupBy=quant`}>/api/benchmarks?model=&amp;groupBy=quant</a>.
        {' '}{t('quant.estimatesNote')}
      </p>
    </section>
  );
}
