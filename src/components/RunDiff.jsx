import React, { useEffect, useRef, useState } from 'react';
import { GitCompare } from 'lucide-react';
import { readParam, writeParams } from '../utils/urlState';
import {
  RUN_ID_HINT,
  formatSecondsAuto,
  runMetaLine,
  diffStatusState,
  buildDiffTableRows
} from '../utils/runDiffView';

// Minimal run-diff panel: two LocalMaxxing run ids in, per-metric deltas,
// ratios and the API's plain-language summary out. Data comes from
// /api/diff — same math the agents use.
export default function RunDiff() {
  const [runA, setRunA] = useState(() => readParam('runA') || '');
  const [runB, setRunB] = useState(() => readParam('runB') || '');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const autoRanRef = useRef(false);
  const [copyNote, setCopyNote] = useState('');

  const runDiff = async () => {
    if (!runA.trim() || !runB.trim()) {
      setError(RUN_ID_HINT);
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

  // Deep-link auto-exec: ?tab=diff&runA=<id>&runB=<id> computes the diff on
  // load instead of waiting for a click, so shared links and headless agents
  // get a rendered result (or a real error) without any interaction.
  useEffect(() => {
    const a = readParam('runA');
    const b = readParam('runB');
    if (!a || !b || autoRanRef.current) return;
    autoRanRef.current = true;
    runDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; reads the URL params the inputs were seeded from
  }, []);


  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.82rem' };
  const rowDivider = { paddingTop: '8px', borderTop: '1px solid var(--border)' };

  // #388: export/copy the exact /api/diff payload already in memory —
  // no second network call needed.
  const copyJson = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopyNote('Copied /api/diff JSON.');
    } catch {
      setCopyNote('Copy failed — use the /api/diff link below.');
    }
  };


  const numStyle = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 };
  const winColor = w => (w === 'B' ? 'var(--decode)' : w === 'A' ? 'var(--prefill)' : 'var(--text-muted)');
  const cellStyle = { padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap' };
  const labelCellStyle = { ...cellStyle, textAlign: 'left', color: 'var(--text-muted)' };

  const fmtCell = (row, value) =>
    row.kind === 'time' ? formatSecondsAuto(value) : (value?.toLocaleString?.() ?? '—');

  const status = diffStatusState({ loading, result, error });
  const rows = buildDiffTableRows(result);
  const metaA = result ? runMetaLine('A', result.runA) : null;
  const metaB = result ? runMetaLine('B', result.runB) : null;

  return (
    <section className="panel" aria-label="Run diff" data-state={status.state}>
      <h2 className="panel-title" style={{ marginBottom: '14px' }} tabIndex={-1} data-panel-heading>
        <GitCompare size={16} />
        <span>Run Diff (measured A vs B)</span>
      </h2>

      {/* #390: machine-readable async state for SR users and DOM-polling agents */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status.announcement}
      </div>

      <div className="panel-inset" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
        <input
          type="text"
          value={runA}
          onChange={(e) => setRunA(e.target.value)}
          placeholder="Run A id"
          aria-label="Run A id"
          style={{ width: '8.125rem' }}
        />
        <input
          type="text"
          value={runB}
          onChange={(e) => setRunB(e.target.value)}
          placeholder="Run B id"
          aria-label="Run B id"
          style={{ width: '8.125rem' }}
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

      {!loading && !result && !error && (
        <p className="hint-text" style={{ marginBottom: '14px' }}>
          Enter two run ids and press “Diff runs” to compute per-metric deltas — or open
          <code>?tab=diff&amp;runA=&lt;id&gt;&amp;runB=&lt;id&gt;</code> to compute it automatically on load.
        </p>
      )}

      {result && (
        <>
          {/* #391: per-side identity so the reader can verify the comparison */}
          {(metaA || metaB) && (
            <div className="panel-inset" style={{ marginBottom: '14px', fontSize: '0.75rem', lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>
              {metaA && <div>{metaA}</div>}
              {metaB && <div>{metaB}</div>}
            </div>
          )}

          <div className="panel-inset" style={{ marginBottom: '14px', fontSize: '0.82rem', lineHeight: 1.5 }}>
            {result.diff.summary}
          </div>

          {/* #388: real table semantics + raw values in data-* attributes */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }} data-testid="diff-metrics-table">
            <caption className="visually-hidden">Per-metric comparison of run A vs run B</caption>
            <thead>
              <tr>
                <th scope="col" style={labelCellStyle}>Metric</th>
                <th scope="col" style={cellStyle}>A</th>
                <th scope="col" style={cellStyle}>B</th>
                <th scope="col" style={cellStyle}>Δ (B−A)</th>
                <th scope="col" style={cellStyle}>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} data-metric={row.key} data-winner={row.winner ?? ''}>
                  <th scope="row" style={labelCellStyle}>{row.label}</th>
                  <td style={{ ...cellStyle, ...numStyle }} data-a={row.a ?? ''}>{fmtCell(row, row.a)}</td>
                  <td style={{ ...cellStyle, ...numStyle }} data-b={row.b ?? ''}>{fmtCell(row, row.b)}</td>
                  <td style={{ ...cellStyle, ...numStyle, color: winColor(row.winner) }} data-delta={row.delta ?? ''}
                      title={row.deltaPct != null ? `${row.deltaPct > 0 ? '+' : ''}${(row.deltaPct * 100).toFixed(2)}%` : undefined}>
                    {row.kind === 'time'
                      ? (row.delta == null ? '—' : `${row.delta > 0 ? '+' : ''}${formatSecondsAuto(row.delta)}`)
                      : (row.delta?.toLocaleString?.() ?? '—')}
                  </td>
                  <td style={{ ...cellStyle, ...numStyle, color: winColor(row.winner) }} data-ratio={row.ratio ?? ''}>
                    {row.ratio != null && row.winner !== 'tie' ? `${row.ratio.toFixed(2)}×` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
            <button className="btn btn-icon" onClick={copyJson}>Copy JSON</button>
            {copyNote && <span className="hint-text">{copyNote}</span>}
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
