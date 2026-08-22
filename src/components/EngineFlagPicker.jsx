import React from 'react';
import { SlidersHorizontal, Check, Info } from 'lucide-react';
import { ENGINE_FLAGS, applyEngineFlags } from '../utils/engineFlags';
import { formatTime } from '../utils/presets';

// Engine flag picker: toggles llama.cpp / vLLM launch flags and shows the
// exact documented delta each one applies to the simulated numbers, with a
// source tag per flag so the model stays auditable.
export default function EngineFlagPicker({
  prefillSpeed,
  decodeSpeed,
  promptTokens = 2048,
  outputTokens = 512,
  selectedFlags,
  onToggleFlag,
  onApplyFlags
}) {
  const result = applyEngineFlags({ prefillSpeed, decodeSpeed, flags: selectedFlags });
  const { adjusted } = result;

  const baseTotal = promptTokens / prefillSpeed + outputTokens / decodeSpeed;
  const adjTotal = promptTokens / adjusted.prefillSpeed + outputTokens / adjusted.decodeSpeed;
  const savedSeconds = baseTotal - adjTotal;

  return (
    <section className="panel" aria-label="Engine flag modeling">
      <div className="field-head" style={{ marginBottom: '10px' }}>
        <span className="panel-title">
          <SlidersHorizontal size={15} />
          Engine Flags
        </span>
        <span className="tag">simulated deltas · auditable</span>
      </div>

      <div className="grid-auto" style={{ '--grid-min': '15rem', alignItems: 'stretch' }}>
        {ENGINE_FLAGS.map(flag => {
          const active = selectedFlags.includes(flag.id);
          return (
            <div
              key={flag.id}
              className="panel-inset"
              style={{
                borderLeft: `2px solid ${active ? 'var(--decode)' : 'var(--border)'}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => onToggleFlag(flag.id)}
                  aria-label={`Toggle engine flag ${flag.flag}`}
                  style={{ marginTop: '2px' }}
                />
                <span>
                  <code style={{ fontSize: '0.72rem', color: 'var(--text-main)' }}>{flag.flag}</code>
                  <span className="tag" style={{ marginLeft: '6px' }}>{flag.engine}</span>
                </span>
              </label>

              <p className="hint-text" style={{ margin: 0 }}>
                {flag.summary}
              </p>

              <p className="hint-text" style={{ margin: 0, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                <Info size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  <strong>Model:</strong> prefill {fmtDelta(flag.prefillMult)}, decode {fmtDelta(flag.decodeMult)}
                  {flag.kvBits ? `, KV cache → ${flag.kvBits}-bit` : ''}
                  {flag.requires ? `. Requires ${getFlagLabel(flag.requires)}.` : ''}
                  {' '}<em title={flag.sourceNote}>({flag.source})</em>
                </span>
              </p>
            </div>
          );
        })}
      </div>

      {/* Audit trail: the composed effect of every active flag, in order */}
      {result.adjustments.length > 0 && (
        <div className="panel-inset" style={{ marginTop: '10px' }}>
          <div className="field-head" style={{ marginBottom: '8px' }}>
            <span className="panel-title">Applied deltas</span>
            <span className="tag tag-decode">
              {adjusted.prefillSpeed} tok/s prefill · {adjusted.decodeSpeed} tok/s decode
            </span>
          </div>
          <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-subtle)' }}>
                <th style={cell}>Flag</th>
                <th style={cell}>Prefill</th>
                <th style={cell}>Decode</th>
                <th style={cell}>KV bits</th>
                <th style={cell}>Source</th>
              </tr>
            </thead>
            <tbody>
              {result.adjustments.map(a => (
                <tr key={a.id}>
                  <td style={cell}><code>{a.flag}</code></td>
                  <td style={cell}>{fmtPct(a.prefillDeltaPct)}</td>
                  <td style={cell}>{fmtPct(a.decodeDeltaPct)}</td>
                  <td style={cell}>{a.kvBits ?? '—'}</td>
                  <td style={cell} title={a.sourceNote}>{a.source}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="hint-text" style={{ marginTop: '8px' }}>
            Composed effect on this workload ({promptTokens.toLocaleString()} → {outputTokens.toLocaleString()} tok):{' '}
            <strong>{formatTime(adjTotal)}</strong> vs <strong>{formatTime(baseTotal)}</strong> unflagged
            (saves {formatTime(Math.max(0, savedSeconds))}).
          </p>

          {result.warnings.map(w => (
            <p key={w} className="hint-text" style={{ marginTop: '4px', color: 'var(--warn, #e0a83a)' }}>
              ⚠ {w}
            </p>
          ))}

          <button
            className="btn btn-accent"
            style={{ marginTop: '10px' }}
            onClick={() => onApplyFlags(adjusted.prefillSpeed, Math.round(adjusted.decodeSpeed))}
          >
            <Check size={15} />
            Apply to simulation ({adjusted.prefillSpeed} / {Math.round(adjusted.decodeSpeed)} tok/s)
          </button>
        </div>
      )}

      {result.adjustments.length === 0 && (
        <p className="hint-text" style={{ marginTop: '4px' }}>
          No flags active — simulation runs at the raw preset speeds. Toggle a flag above to see its
          documented effect. All deltas are heuristics, not measurements: midpoints of published
          ranges with a source note on every flag.
        </p>
      )}
    </section>
  );
}

function getFlagLabel(id) {
  const f = ENGINE_FLAGS.find(x => x.id === id);
  return f ? f.flag : id;
}

function fmtDelta(mult) {
  const pct = (mult - 1) * 100;
  if (pct === 0) return '±0%';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

function fmtPct(p) {
  if (p === null || p === 0) return '±0%';
  return `${p > 0 ? '+' : ''}${p}%`;
}

const cell = { padding: '4px 8px 4px 0', borderBottom: '1px solid var(--line)' };
