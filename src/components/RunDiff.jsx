import React, { useState } from 'react';
import { GitCompare } from 'lucide-react';
import { readParam, writeParams } from '../utils/urlState';

// Minimal run-diff panel: two LocalMaxxing run ids in, per-metric deltas,
// ratios and the API's plain-language summary out. Data comes from
// /api/diff — same math the agents use.
export default function RunDiff() {
  const [runA, setRunA] = useState(() => readParam('runA') || '');
  const [runB, setRunB] = useState(() => readParam('runB') || '');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const runDiff = async () => {
    if (!runA.trim() || !runB.trim()) {
      setError('Enter two run ids (find them via the LocalMaxxing picker or /api/localmaxxing).');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/diff?runA=${encodeURIComponent(runA.trim())}&runB=${encodeURIComponent(runB.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `API returned ${res.status}`);
      setResult(json);
      writeParams({ tab: 'diff', runA: runA.trim(), runB: runB.trim() });
    } catch (e) {
      setResult(null);
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.82rem' };
  const rowDivider = { paddingTop: '8px', borderTop: '1px solid var(--border)' };
  const numStyle = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 };
  const winColor = w => (w === 'B' ? 'var(--decode)' : w === 'A' ? 'var(--prefill)' : 'var(--text-muted)');

  const metricRows = result ? [
    ['Prefill (tok/s)', result.diff.metrics.prefill, 0],
    ['Decode (tok/s)', result.diff.metrics.decode, 0],
    ['TTFT @ 2k prompt (s)', result.diff.metrics.ttft, 2],
    ['TPOT (s)', result.diff.metrics.tpot, 3],
    ['Walltime @ 2k/512 (s)', result.diff.metrics.walltime, 2]
  ] : [];

  return (
    <section className="panel" aria-label="Run diff">
      <h2 className="panel-title" style={{ marginBottom: '14px' }}>
        <GitCompare size={16} />
        <span>Run Diff (measured A vs B)</span>
      </h2>

      <div className="panel-inset" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
        <input
          type="text"
          value={runA}
          onChange={(e) => setRunA(e.target.value)}
          placeholder="Run A id"
          aria-label="Run A id"
          style={{ width: '130px' }}
        />
        <input
          type="text"
          value={runB}
          onChange={(e) => setRunB(e.target.value)}
          placeholder="Run B id"
          aria-label="Run B id"
          style={{ width: '130px' }}
        />
        <button className="btn" onClick={runDiff} disabled={loading}>
          {loading ? 'Diffing…' : 'Diff runs'}
        </button>
      </div>

      {error && (
        <div className="panel-inset" role="alert" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', fontSize: '0.78rem', marginBottom: '14px' }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="panel-inset" style={{ marginBottom: '14px', fontSize: '0.82rem', lineHeight: 1.5 }}>
            {result.diff.summary}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: 'var(--text-muted)' }}>
            {metricRows.map(([label, m, digits]) => (
              <div key={label} style={{ ...rowStyle, ...rowDivider }}>
                <span>{label}</span>
                <span style={{ display: 'flex', gap: '12px', alignItems: 'baseline' }}>
                  <span style={{ ...numStyle, color: winColor(m.winner) }}>
                    {m.a?.toLocaleString?.() ?? '—'} → {m.b?.toLocaleString?.() ?? '—'}
                  </span>
                  {m.deltaPct !== null && (
                    <span style={{ ...numStyle, fontSize: '0.72rem', color: winColor(m.winner) }}>
                      {m.deltaPct > 0 ? '+' : ''}{(m.deltaPct * 100).toFixed(digits)}%
                    </span>
                  )}
                  {m.ratio !== null && m.winner !== 'tie' && (
                    <span style={{ ...numStyle, fontSize: '0.72rem', color: winColor(m.winner) }}>
                      {m.ratio.toFixed(2)}×
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <p className="hint-text" style={{ marginTop: '10px' }}>
            Deltas are B − A; ratios are B ÷ A. Time metrics are normalized to a 2048-token prompt / 512-token output.
            Same JSON via <a href={`/api/diff?runA=${encodeURIComponent(runA)}&runB=${encodeURIComponent(runB)}`}>/api/diff</a>.
          </p>
        </>
      )}
    </section>
  );
}
