import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Database, ExternalLink, LoaderCircle, Search } from 'lucide-react';
import { readParam, writeParams } from '../utils/urlState';
import {
  fetchComparableRuns,
  fetchModels,
  getQuantizations,
  runLabel,
  toLocalPreset
} from '../utils/localMaxxing';

const selectStyle = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0F172A',
  fontSize: '0.82rem',
  fontWeight: '600'
};

export default function LocalMaxxingPresetPicker({ selectedPreset, onApplyRun, onContextChange }) {
  const initialRunId = useRef(readParam('lmxRun'));
  const restoredRun = useRef(false);
  const [models, setModels] = useState([]);
  const [modelInput, setModelInput] = useState(() => readParam('lmxModel') || '');
  const [modelId, setModelId] = useState(() => readParam('lmxModel') || '');
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

  useEffect(() => {
    if (!modelId) {
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
  }, [modelId]);

  const quantizations = useMemo(() => getQuantizations(runs), [runs]);
  const eligibleRuns = useMemo(
    () => runs.filter(run => (run.engine?.quantization || 'Unknown') === quantization),
    [runs, quantization]
  );
  const selectedRun = eligibleRuns.find(run => run.id === selectedRunId);
  const active = selectedPreset === `lmx:${selectedRunId}`;

  useEffect(() => {
    onContextChange({
      modelId,
      quantization,
      runs: eligibleRuns,
      selectedRunId
    });
    writeParams({
      lmxModel: modelId || null,
      lmxQuant: quantization || null,
      lmxRun: selectedRunId || null
    });
  }, [eligibleRuns, modelId, onContextChange, quantization, selectedRunId]);

  useEffect(() => {
    if (restoredRun.current || !initialRunId.current || !eligibleRuns.length) return;
    const run = eligibleRuns.find(item => item.id === initialRunId.current);
    restoredRun.current = true;
    if (run) onApplyRun(run);
  }, [eligibleRuns, onApplyRun]);

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
    const run = eligibleRuns.find(item => item.id === runId);
    if (run) onApplyRun(run);
  };

  return (
    <section className="material-card" style={{ margin: '16px 16px 0', padding: '16px 20px', background: '#FFFFFF' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={19} color="#4F46E5" />
            <strong style={{ color: '#0F172A', fontSize: '0.95rem' }}>LocalMaxxing measured presets</strong>
            <span className="badge badge-neutral">Live community runs</span>
          </div>
          <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: '0.76rem' }}>
            Pick one model and quant. Only single-stream runs with measured prefill and decode speeds are shown.
          </p>
        </div>
        <a href="https://localmaxxing.com/en/leaderboard" target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#4F46E5', fontSize: '0.76rem', fontWeight: '700' }}>
          Open leaderboard <ExternalLink size={13} />
        </a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1.2fr) minmax(160px, 0.55fr) minmax(300px, 1.7fr)', gap: '12px', marginTop: '14px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', color: '#475569', fontSize: '0.72rem', fontWeight: '700' }}>
          Model repository
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              list="localmaxxing-models"
              value={modelInput}
              onChange={event => setModelInput(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') loadModel(); }}
              placeholder={loadingModels ? 'Loading models…' : 'Search or enter Hugging Face model ID'}
              style={{ ...selectStyle, minWidth: 0 }}
            />
            <button onClick={loadModel} title="Load LocalMaxxing runs for this model" style={{ width: '38px', border: '1px solid #CBD5E1', borderRadius: '8px', background: '#EEF2FF', color: '#4F46E5', cursor: 'pointer' }}>
              {loadingRuns ? <LoaderCircle size={17} className="spin" /> : <Search size={17} />}
            </button>
          </div>
          <datalist id="localmaxxing-models">
            {models.map(model => <option key={model.hfId} value={model.hfId}>{model._count?.benchmarkRuns || 0} runs</option>)}
          </datalist>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', color: '#475569', fontSize: '0.72rem', fontWeight: '700' }}>
          Quantization
          <select
            value={quantization}
            onChange={event => {
              setQuantization(event.target.value);
              setSelectedRunId('');
            }}
            disabled={!quantizations.length}
            style={selectStyle}
          >
            {!quantizations.length && <option value="">Load a model first</option>}
            {quantizations.map(quant => <option key={quant} value={quant}>{quant}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', color: '#475569', fontSize: '0.72rem', fontWeight: '700' }}>
          Hardware run ({eligibleRuns.length} comparable)
          <select value={selectedRunId} onChange={handleRunChange} disabled={!eligibleRuns.length} style={selectStyle}>
            <option value="">Select hardware to prefill speeds</option>
            {eligibleRuns.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}
          </select>
        </label>
      </div>

      {error && <p style={{ margin: '10px 0 0', color: '#B91C1C', fontSize: '0.76rem', fontWeight: '600' }}>{error}</p>}
      {modelId && !loadingRuns && runs.length === 0 && !error && (
        <p style={{ margin: '10px 0 0', color: '#92400E', fontSize: '0.76rem' }}>No single-stream runs contain both prefill and decode measurements for this model.</p>
      )}
      {selectedRun && (
        <div style={{ marginTop: '10px', padding: '9px 11px', borderRadius: '8px', background: active ? '#ECFDF5' : '#F8FAFC', border: `1px solid ${active ? '#A7F3D0' : '#E2E8F0'}`, display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.76rem' }}>
          <span style={{ color: active ? '#065F46' : '#475569', fontWeight: '700' }}>
            {active ? 'Applied' : 'Selected'}: {toLocalPreset(selectedRun).description}
          </span>
          <a href={`https://localmaxxing.com/en/runs/${selectedRun.id}`} target="_blank" rel="noreferrer" style={{ color: '#4F46E5', fontWeight: '700' }}>View source run</a>
        </div>
      )}
    </section>
  );
}
