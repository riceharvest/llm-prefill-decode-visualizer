import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Database, ExternalLink, LoaderCircle, RotateCcw, Search } from 'lucide-react';
import { readParam, writeParams } from '../utils/urlState';
import {
  fetchComparableRuns,
  fetchModels,
  getQuantizations,
  runLabel,
  toLocalPreset
} from '../utils/localMaxxing';
import {
  fetchAllComparableRuns,
  getHardwareGroups,
  getModelsForHardware,
  getQuantsForHardwareModel,
  setFetchProgressListener
} from '../utils/hardwareFirst';
import { t } from '../i18n/strings';

const selectStyle = {
  width: '100%'
};

export default function LocalMaxxingPresetPicker({ selectedPreset, onApplyRun, onContextChange }) {
  const initialRunId = useRef(readParam('lmxRun'));
  const restoredRun = useRef(false);
  // Selection order: 'model' = model → quant → hardware (original flow).
  // 'hardware' = hardware → model → quant.
  const [pickOrder, setPickOrder] = useState(() => readParam('lmxOrder') === 'hw' ? 'hardware' : 'model');
  const [models, setModels] = useState([]);
  const [modelInput, setModelInput] = useState(() => readParam('lmxModel') || '');
  const [modelId, setModelId] = useState(() => readParam('lmxModel') || '');

  // Hardware-first state
  const [allRuns, setAllRuns] = useState([]);
  const [hardwareKey, setHardwareKey] = useState(() => readParam('lmxHw') || '');
  const [loadingAll, setLoadingAll] = useState(false);

  const [runs, setRuns] = useState([]);
  const [quantization, setQuantization] = useState(() => readParam('lmxQuant') || '');
  const [selectedRunId, setSelectedRunId] = useState(() => readParam('lmxRun') || '');
  const [loadingModels, setLoadingModels] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetchModels(controller.signal)
      .then(setModels)
      .catch(err => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoadingModels(false));
    return () => controller.abort();
  }, []);

  // Hardware-first mode needs the full comparable-run index (fetched once,
  // ~150 KB gzipped; shared across mode switches via a module-level cache).
  const [fetchProgress, setFetchProgress] = useState(null); // { pages, rows }
  useEffect(() => setFetchProgressListener(setFetchProgress), []);

  // Bumped by the Retry button to re-attempt a failed index fetch.
  const [fetchAttempt, setFetchAttempt] = useState(0);

  useEffect(() => {
    if (pickOrder !== 'hardware') return undefined;
    if (allRuns.length) return undefined;
    const controller = new AbortController();
    setLoadingAll(true);
    setError('');
    fetchAllComparableRuns(controller.signal)
      .then(rows => {
        setAllRuns(rows);
        setFetchProgress(null);
      })
      .catch(err => {
        setFetchProgress(null);
        if (err.name !== 'AbortError') setError(`${err.message} — check your connection and retry.`);
      })
      .finally(() => setLoadingAll(false));
    return () => controller.abort();
  }, [pickOrder, allRuns.length, fetchAttempt]);

  // Model-first flow: per-model run list from the API
  useEffect(() => {
    if (pickOrder !== 'model' || !modelId) {
      setRuns([]);
      return undefined;
    }

    const controller = new AbortController();
    setLoadingRuns(true);
    setError('');
    fetchComparableRuns(modelId, controller.signal)
      .then(nextRuns => {
        setRuns(nextRuns);
        const quantizations = getQuantizations(nextRuns);
        setQuantization(current => quantizations.includes(current) ? current : (quantizations[0] || ''));
      })
      .catch(err => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoadingRuns(false));
    return () => controller.abort();
  }, [pickOrder, modelId]);

  const quantizations = useMemo(() => getQuantizations(runs), [runs]);
  const eligibleRuns = useMemo(
    () => runs.filter(run => (run.engine?.quantization || 'Unknown') === quantization),
    [runs, quantization]
  );

  // Hardware-first derived lists
  const hardwareGroups = useMemo(
    () => pickOrder === 'hardware' ? getHardwareGroups(allRuns) : [],
    [pickOrder, allRuns]
  );
  const hwModelIds = useMemo(
    () => (pickOrder === 'hardware' && hardwareKey) ? getModelsForHardware(allRuns, hardwareKey) : [],
    [pickOrder, allRuns, hardwareKey]
  );
  const hwQuantRuns = useMemo(
    () => (pickOrder === 'hardware' && hardwareKey && modelId)
      ? getQuantsForHardwareModel(allRuns, hardwareKey, modelId)
      : [],
    [pickOrder, allRuns, hardwareKey, modelId]
  );
  const hwQuantizations = useMemo(() => getQuantizations(hwQuantRuns), [hwQuantRuns]);

  // Hardware-first flow: auto-select the most common quantization when a new
  // hardware+model pair resolves (mirrors the model-flow behavior).
  useEffect(() => {
    if (pickOrder !== 'hardware') return;
    setQuantization(current => hwQuantizations.includes(current) ? current : (hwQuantizations[0] || ''));
  }, [pickOrder, hwQuantizations]);
  const hwEligibleRuns = useMemo(
    () => hwQuantRuns.filter(run => (run.engine?.quantization || 'Unknown') === quantization),
    [hwQuantRuns, quantization]
  );

  const selectedRun = pickOrder === 'hardware'
    ? (allRuns.find(run => run.id === selectedRunId))
    : eligibleRuns.find(run => run.id === selectedRunId);
  const active = selectedPreset === `lmx:${selectedRunId}`;

  // Runs the current selection resolves to (used for both flows downstream)
  const effectiveRuns = pickOrder === 'hardware' ? hwEligibleRuns : eligibleRuns;

  useEffect(() => {
    onContextChange({
      modelId,
      quantization,
      runs: effectiveRuns,
      selectedRunId
    });
    writeParams({
      lmxOrder: pickOrder === 'hardware' ? 'hw' : null,
      lmxModel: modelId || null,
      lmxQuant: quantization || null,
      lmxRun: selectedRunId || null,
      lmxHw: hardwareKey || null
    });
  }, [effectiveRuns, hardwareKey, modelId, onContextChange, pickOrder, quantization, selectedRunId]);

  useEffect(() => {
    if (restoredRun.current || !initialRunId.current || !effectiveRuns.length) return;
    const run = effectiveRuns.find(item => item.id === initialRunId.current);
    restoredRun.current = true;
    if (run) onApplyRun(run);
  }, [effectiveRuns, onApplyRun]);

  const loadModel = () => {
    const value = modelInput.trim();
    if (!value) return;
    restoredRun.current = true;
    setModelId(value);
    setQuantization('');
    setSelectedRunId('');
  };

  const handleRunChange = event => {
    const runId = event.target.value;
    setSelectedRunId(runId);
    const pool = pickOrder === 'hardware' ? allRuns : eligibleRuns;
    const run = pool.find(item => item.id === runId);
    if (run) onApplyRun(run);
  };

  const togglePickOrder = () => {
    restoredRun.current = true;
    setPickOrder(order => order === 'model' ? 'hardware' : 'model');
    setQuantization('');
    setSelectedRunId('');
    setHardwareKey('');
  };

  return (
    <section className="panel" aria-label={t('localMaxxing.panelAria')}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Database size={16} style={{ color: 'var(--accent)' }} />
            <strong style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>{t('localMaxxing.title')}</strong>
            <span className="tag tag-accent">{t('localMaxxing.liveRunsTag')}</span>
          </div>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            {pickOrder === 'hardware'
              ? t('localMaxxing.introHardwareFirst')
              : t('localMaxxing.introModelFirst')}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={togglePickOrder} className="btn" style={{ fontSize: '0.72rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            title={pickOrder === 'model' ? t('localMaxxing.switchToHardwareTitle') : t('localMaxxing.switchToModelTitle')}
            aria-label={pickOrder === 'model' ? t('localMaxxing.switchToHardwareTitle') : t('localMaxxing.switchToModelTitle')}
            aria-pressed={pickOrder === 'hardware'}>
            <ArrowLeftRight size={13} />
            {pickOrder === 'hardware' ? t('localMaxxing.modelFirst') : t('localMaxxing.hardwareFirst')}
          </button>
          <a href="https://localmaxxing.com/en/leaderboard" target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.76rem', fontWeight: 600 }}>
            {t('localMaxxing.openLeaderboard')} <ExternalLink size={13} />
          </a>
        </div>
      </div>

      {pickOrder === 'model' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '14px' }}>
          <label className="field-label" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {t('localMaxxing.modelRepository')}
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                list="localmaxxing-models"
                value={modelInput}
                onChange={event => setModelInput(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') loadModel(); }}
                placeholder={loadingModels ? t('localMaxxing.loadingModelsPlaceholder') : t('localMaxxing.searchModelPlaceholder')}
                style={{ ...selectStyle, minWidth: 0 }}
              />
              <button onClick={loadModel} title={t('localMaxxing.loadRunsTooltip')} aria-label={t('localMaxxing.loadRunsAria')} className="btn btn-icon" style={{ minHeight: '34px', flexShrink: 0 }}>
                {loadingRuns ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
              </button>
            </div>
            <datalist id="localmaxxing-models">
              {models.map(model => <option key={model.hfId} value={model.hfId}>{model._count?.benchmarkRuns || 0} {t('localMaxxing.runsCountSuffix')}</option>)}
            </datalist>
          </label>

          <label className="field-label" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {t('localMaxxing.quantization')}
            <select
              value={quantization}
              onChange={event => {
                setQuantization(event.target.value);
                setSelectedRunId('');
              }}
              disabled={!quantizations.length}
              style={selectStyle}
            >
              {!quantizations.length && <option value="">{t('localMaxxing.loadModelFirst')}</option>}
              {quantizations.map(quant => <option key={quant} value={quant}>{quant}</option>)}
            </select>
          </label>

          <label className="field-label" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {t('localMaxxing.hardwareRunLabel', { count: eligibleRuns.length })}
            <select value={selectedRunId} onChange={handleRunChange} disabled={!eligibleRuns.length} style={selectStyle}>
              <option value="">{t('localMaxxing.selectHardwareOption')}</option>
              {eligibleRuns.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '14px' }}>
          <label className="field-label" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {t('localMaxxing.hardwareCountLabel', { count: hardwareGroups.length })}
            <select
              value={hardwareKey}
              onChange={event => {
                restoredRun.current = true;
                setHardwareKey(event.target.value);
                setModelId('');
                setModelInput('');
                setQuantization('');
                setSelectedRunId('');
              }}
              disabled={loadingAll || !hardwareGroups.length}
              style={selectStyle}
            >
              <option value="">
                {loadingAll
                  ? fetchProgress
                    ? t('localMaxxing.loadingCommunityRunsWithProgress', { rows: fetchProgress.rows.toLocaleString(), pages: fetchProgress.pages })
                    : t('localMaxxing.loadingCommunityRuns')
                  : t('localMaxxing.selectHardware')}
              </option>
              {hardwareGroups.map(key => (
                <option key={key} value={key}>
                  {allRuns.find(r => r.hardwareGroupKey === key)?.hardwareGroupLabel || key} ({allRuns.filter(r => r.hardwareGroupKey === key).length})
                </option>
              ))}
            </select>
          </label>

          <label className="field-label" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {t('localMaxxing.modelRepository')}
            <select
              value={modelId}
              onChange={event => {
                restoredRun.current = true;
                setModelId(event.target.value);
                setQuantization('');
                setSelectedRunId('');
              }}
              disabled={!hardwareKey || !hwModelIds.length}
              style={selectStyle}
            >
              <option value="">{!hardwareKey ? t('localMaxxing.pickHardwareFirst') : t('localMaxxing.selectModel', { count: hwModelIds.length })}</option>
              {hwModelIds.map(hfId => (
                <option key={hfId} value={hfId}>
                  {hfId} ({allRuns.filter(r => r.hardwareGroupKey === hardwareKey && r.model?.hfId === hfId).length})
                </option>
              ))}
            </select>
          </label>

          <label className="field-label" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {t('localMaxxing.quantizationRunLabel', { count: hwEligibleRuns.length })}
            <select value={selectedRunId} onChange={handleRunChange} disabled={!hwEligibleRuns.length} style={selectStyle}>
              <option value="">{!modelId ? t('localMaxxing.pickModelFirst') : t('localMaxxing.selectMeasuredRun')}</option>
              {hwEligibleRuns.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}
            </select>
          </label>
        </div>
      )}

      {error && (
        <p style={{ margin: '10px 0 0', color: 'var(--danger)', fontSize: '0.76rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span>{error}</span>
          <button
            onClick={() => { setError(''); setFetchAttempt(a => a + 1); }}
            className="btn"
            style={{ padding: '3px 10px', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
          >
            <RotateCcw size={12} /> {t('common.retry')}
          </button>
        </p>
      )}
      {pickOrder === 'model' && modelId && !loadingRuns && runs.length === 0 && !error && (
        <p style={{ margin: '10px 0 0', color: 'var(--agent)', fontSize: '0.76rem' }}>{t('localMaxxing.noRunsForModel')}</p>
      )}
      {pickOrder === 'hardware' && hardwareKey && modelId && !loadingAll && hwQuantRuns.length === 0 && !error && (
        <p style={{ margin: '10px 0 0', color: 'var(--agent)', fontSize: '0.76rem' }}>{t('localMaxxing.noRunsForPair')}</p>
      )}
      {selectedRun && (
        <div className="panel-inset" style={{ marginTop: '10px', borderColor: active ? 'var(--decode-border)' : 'var(--border)', background: active ? 'var(--decode-dim)' : 'var(--bg-inset)', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.76rem' }}>
          <span style={{ color: active ? 'var(--decode)' : 'var(--text-muted)', fontWeight: 600 }}>
            {active ? t('common.applied') : t('common.selected')}: {toLocalPreset(selectedRun).description}
          </span>
          <a href={`https://localmaxxing.com/en/runs/${selectedRun.id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>View source run</a>
        </div>
      )}
    </section>
  );
}
