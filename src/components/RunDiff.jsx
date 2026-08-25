import React, { useEffect, useRef, useState } from 'react';
import { GitCompare } from 'lucide-react';
import { readParam, writeParams } from '../utils/urlState';
import { fetchJsonWithTimeout, FetchJsonError } from '../utils/fetchJson';

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

  const runDiff = async () => {
    if (!runA.trim() || !runB.trim()) {
      setError('Enter two run ids (find them via the LocalMaxxing picker or /api/localmaxxing).');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Shared helper (#723): bounded by a timeout (the button can no longer
      // stick on "Diffing…" forever) and guarded against non-JSON responses
      // (WAF challenge HTML no longer surfaces as a SyntaxError).
      const json = await fetchJsonWithTimeout(
        `/api/diff?runA=${encodeURIComponent(runA.trim())}&runB=${encodeURIComponent(runB.trim())}`
      );
      setResult(json);
      writeParams({ tab: 'diff', runA: runA.trim(), runB: runB.trim() });
    } catch (e) {
      setResult(null);
      setError(
        e instanceof FetchJsonError
          ? e.kind === 'http'
            ? `${e.message} (HTTP ${e.status})`
            : e.message
          : String(e.message || e)
      );
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
      <h2 className="panel-title" style={{ marginBottom: '14px' }} tabIndex={-1} data-panel-heading>
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
