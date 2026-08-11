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
  width: '100%'
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
    <section className="panel" aria-label="LocalMaxxing measured presets">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Database size={16} style={{ color: 'var(--accent)' }} />
            <strong style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>LocalMaxxing measured presets</strong>
            <span className="tag tag-accent">live community runs</span>
          </div>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            Pick one model and quant. Only single-stream runs with measured prefill and decode speeds are shown.
          </p>
        </div>
        <a href="https://localmaxxing.com/en/leaderboard" target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.76rem', fontWeight: 600 }}>
          Open leaderboard <ExternalLink size={13} />
        </a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '14px' }}>
        <label className="field-label" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          Model repository
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              list="localmaxxing-models"
              value={modelInput}
              onChange={event => setModelInput(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') loadModel(); }}
              placeholder={loadingModels ? 'Loading models…' : 'Search or enter Hugging Face model ID'}
              style={{ ...selectStyle, minWidth: 0 }}
            />
            <button onClick={loadModel} title="Load LocalMaxxing runs for this model" aria-label="Load runs for model" className="btn btn-icon" style={{ minHeight: '34px', flexShrink: 0 }}>
              {loadingRuns ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
            </button>
          </div>
          <datalist id="localmaxxing-models">
            {models.map(model => <option key={model.hfId} value={model.hfId}>{model._count?.benchmarkRuns || 0} runs</option>)}
          </datalist>
        </label>

        <label className="field-label" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
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

        <label className="field-label" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          Hardware run ({eligibleRuns.length} comparable)
          <select value={selectedRunId} onChange={handleRunChange} disabled={!eligibleRuns.length} style={selectStyle}>
            <option value="">Select hardware to prefill speeds</option>
            {eligibleRuns.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}
          </select>
        </label>
      </div>

      {error && <p style={{ margin: '10px 0 0', color: 'var(--danger)', fontSize: '0.76rem', fontWeight: 600 }}>{error}</p>}
      {modelId && !loadingRuns && runs.length === 0 && !error && (
        <p style={{ margin: '10px 0 0', color: 'var(--agent)', fontSize: '0.76rem' }}>No single-stream runs contain both prefill and decode measurements for this model.</p>
      )}
      {selectedRun && (
        <div className="panel-inset" style={{ marginTop: '10px', borderColor: active ? 'var(--decode-border)' : 'var(--border)', background: active ? 'var(--decode-dim)' : 'var(--bg-inset)', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.76rem' }}>
          <span style={{ color: active ? 'var(--decode)' : 'var(--text-muted)', fontWeight: 600 }}>
            {active ? 'Applied' : 'Selected'}: {toLocalPreset(selectedRun).description}
          </span>
          <a href={`https://localmaxxing.com/en/runs/${selectedRun.id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>View source run</a>
        </div>
      )}
    </section>
  );
}
