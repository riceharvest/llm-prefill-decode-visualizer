import React from 'react';
import { formatTokens } from '../utils/presets';
import { t } from '../i18n/strings';
import { buildKvMatrixSummary } from '../utils/chartAccessibility';

// Visual rows in each matrix. Real prompts are thousands of tokens, so the
// matrix is a proportional abstraction: a "row" lights up once its share of
// tokens exists. The pedagogy is in the fill *pattern*, not the row count —
// prefill writes every row simultaneously, decode appends one row at a time.
const KV_ROWS = 14;

/**
 * One KV-cache matrix.
 *
 * variant='parallel' (prefill): every row carries the SAME fill fraction, so
 * the whole grid visibly fills at once — the compute-bound signature. The
 * filled span is split into an agent-colored cached prefix (prefix caching)
 * and a prefill-colored delta that grows as new tokens are ingested.
 *
 * variant='append' (decode): rows are binary — fully written or empty — and
 * flip one by one as generated tokens append to the cache, with the newest
 * row pulsing. The memory-bound signature: one token per step.
 */
export default function KVCacheMatrix({
  title,
  icon,
  tone = 'prefill',
  variant = 'parallel',
  totalTokens = 0,
  progress = 0,
  cachedTokens = 0,
  active = false,
  captions = {}
}) {
  const safeTotal = Math.max(0, totalTokens || 0);
  const safeProgress = Math.min(safeTotal, Math.max(0, progress || 0));
  const safeCached = Math.min(safeProgress, Math.max(0, cachedTokens || 0));
  const fillFrac = safeTotal > 0 ? safeProgress / safeTotal : 0;
  const cachedFracOfFill = safeProgress > 0 ? safeCached / safeProgress : 0;

  // Decode rows flip discretely: a visual row is "written" once its token
  // share has been generated. At least the newest partial row shows as latest.
  const appendedRows = variant === 'append' && safeTotal > 0
    ? Math.floor((safeProgress / safeTotal) * KV_ROWS + 1e-9)
    : KV_ROWS;

  const toneVar = `var(--${tone === 'agent' ? 'agent' : tone})`;

  return (
    <div
      className={`panel-inset kv-matrix${active ? ' kv-active' : ''}`}
      style={{
        borderColor: active ? `${toneVar}` : 'var(--border)',
        background: active ? `var(--${tone}-dim)` : 'var(--bg-inset)'
      }}
    >
      <div className="field-head" style={{ marginBottom: '6px' }}>
        <span className="panel-title" style={{ color: toneVar, fontSize: '0.74rem' }}>
          {icon}{title}
        </span>
        <span className="hint-text" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', fontVariantNumeric: 'tabular-nums' }}>
          {formatTokens(Math.round(safeProgress))} / {formatTokens(Math.round(safeTotal))} tok
        </span>
      </div>

      {/* Full a11y text contract (#922): role="img" prunes children, so the
          label must carry the row count (matching the discrete append
          rendering), the appending newest-row marker, and the prefix-cache
          share — all previously visual-only. */}
      <div className="kv-grid" role="img" aria-label={buildKvMatrixSummary({
        title,
        variant,
        fillFrac,
        appendedRows,
        totalRows: KV_ROWS,
        cachedFracOfFill
      })}>
        {Array.from({ length: KV_ROWS }, (_, i) => {
          if (variant === 'parallel') {
            // All rows share one fill level — written simultaneously.
            return (
              <div key={i} className="kv-row">
                {fillFrac > 0 && (
                  <div className="kv-row-fill" style={{ width: `${fillFrac * 100}%` }}>
                    {safeCached > 0 && (
                      <div className="kv-row-cached" style={{ width: `${cachedFracOfFill * 100}%` }} />
                    )}
                  </div>
                )}
              </div>
            );
          }
          const isWritten = i < appendedRows;
          const isLatest = isWritten && i === appendedRows - 1 && safeProgress < safeTotal;
          return (
            <div key={i} className={`kv-row${isWritten ? ' kv-written' : ''}${isLatest ? ' kv-latest' : ''}`}>
              {isWritten && <div className="kv-row-fill" style={{ width: '100%' }} />}
            </div>
          );
        })}
      </div>

      {(captions.legend || captions.hint) && (
        <div className="kv-legend" style={{ marginTop: '8px' }}>
          {captions.legend && (
            <span className="kv-legend-item">
              <span className="kv-swatch" style={{ background: toneVar }} />
              {captions.legend}
            </span>
          )}
          {captions.cachedLegend && (
            <span className="kv-legend-item">
              <span className="kv-swatch kv-swatch-cached" />
              {captions.cachedLegend}
            </span>
          )}
        </div>
      )}

      {captions.caption && (
        <p className="hint-text" style={{ marginTop: safeCached > 0 || captions.legend ? '6px' : '8px' }}>
          {captions.caption}
        </p>
      )}
    </div>
  );
}

/** Shared section header for the KV-cache matrix pair. */
export function KVCacheSectionHeader({ label }) {
  return (
    <div className="field-head" style={{ marginBottom: '10px' }}>
      <span className="section-label">{label}</span>
      <span className="hint-text" style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)' }}>
        {t('kv.rowUnit', { rows: KV_ROWS })}
      </span>
    </div>
  );
}
