import React, { useId, useState } from 'react';
import { Table2 } from 'lucide-react';
import { t } from '../i18n/strings';
import { chartTableTestId } from '../utils/testids';

/**
 * ChartDataTable (#75) — accessible data-table alternative for charts.
 *
 * Every visualization gets an equivalent table so screen-reader and low-vision
 * users can read exact values instead of estimating from bar lengths or
 * segment widths. Two presentation modes:
 *
 *   mode="disclosure"  — a "View as table" toggle button; the table renders
 *                        inside an expandable region (aria-expanded/controls).
 *                        Use for larger charts where the table is genuinely
 *                        useful to sighted users too.
 *
 *   mode="sr-only"     — visually hidden but keyboard-focusable: the wrapper
 *                        is clipped until it receives focus, then expands in
 *                        place so sighted keyboard users can scroll/read it.
 *                        Use next to small decorative bars that already show
 *                        their numbers inline.
 *
 * Markup contract:
 *   <caption> names the data; column headers are <th scope="col">; each row's
 *   first cell is <th scope="row">. Numeric columns get className="num".
 *
 * Props:
 *   caption        — required string; becomes <caption> + focus/region label
 *   rowHeaderLabel — header text for the first (row-label) column
 *   columns        — [{ key, label, numeric? }] (row-label column excluded)
 *   rows           — [{ id, label, cells: { [columnKey]: string } }]
 *   mode           — 'disclosure' (default) | 'sr-only'
 *   defaultOpen    — initial open state in disclosure mode
 */
export default function ChartDataTable({
  caption,
  rowHeaderLabel,
  columns = [],
  rows = [],
  mode = 'disclosure',
  defaultOpen = false
}) {
  const [open, setOpen] = useState(defaultOpen);
  // `useId()` stays ONLY for internal aria wiring (button ↔ region ids) — it
  // is never exposed to agents. The agent-facing hook below is a build-stable
  // slug of the English caption (#641): mount order and React versions can
  // no longer renumber it.
  const idPrefix = useId();

  if (!caption || rows.length === 0) return null;

  const table = (
    <div className="table-wrap">
      <table className="data-table">
        <caption style={{ textAlign: 'left', padding: '6px 12px', color: 'var(--text-muted)', fontSize: '0.72rem', captionSide: 'top' }}>
          {caption}
        </caption>
        <thead>
          <tr>
            <th scope="col">{rowHeaderLabel}</th>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.numeric ? 'num' : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              {columns.map((col) => (
                <td key={col.key} className={col.numeric ? 'num' : undefined}>
                  {row.cells[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (mode === 'sr-only') {
    return (
      <div
        className="visually-hidden-focusable"
        tabIndex={0}
        role="region"
        aria-label={caption}
      >
        {table}
      </div>
    );
  }

  const regionId = `${idPrefix}-region`;
  return (
    <div style={{ marginTop: '14px' }}>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls={regionId}
        /* Distinct name per chart: SR users tabbing between several
           "View as table" toggles need to know which chart each targets. */
        aria-label={open
          ? `${t('chartTable.hideTable')}: ${caption}`
          : `${t('chartTable.viewAsTable')}: ${caption}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Table2 size={13} style={{ verticalAlign: '-2px', marginInlineEnd: '5px' }} aria-hidden="true" />
        {open ? t('chartTable.hideTable') : t('chartTable.viewAsTable')}
      </button>
      {open && (
        <div id={regionId} role="group" aria-label={caption} style={{ marginTop: '10px' }} data-testid={chartTableTestId(caption)} data-chart-data-table={chartTableTestId(caption)}>
          {table}
        </div>
      )}
    </div>
  );
}
