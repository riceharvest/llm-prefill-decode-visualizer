// Export builders for the Find-HW shortlist (issue #442).
//
// The ranked shortlist previously existed only as styled divs — no export,
// no copy path, no table semantics — so agents and AT could not consume the
// site's recommendation surface. These pure builders mirror the on-page
// ranking into deterministic JSON / Markdown payloads; HardwareShortlist
// renders them behind Export JSON / Copy MD buttons and an sr-only table.
//
// Like exportJson.js, output is byte-deterministic given the same inputs
// (generatedAt pinned by the caller), so exports are diffable/replayable.

export const SHORTLIST_EXPORT_VERSION = 1;

/**
 * Build the machine-readable JSON export of a ranked shortlist.
 * rows: the ranked groups exactly as rendered (post-filters), in rank order.
 */
export function buildShortlistJson({ rows, filters = {}, matchedRuns = 0, excludedSingleRunGroups = 0, deepLink = '', generatedAt = new Date().toISOString() }) {
  return {
    schemaVersion: SHORTLIST_EXPORT_VERSION,
    generator: 'llm-prefill-decode-visualizer',
    exportType: 'hardware-shortlist',
    generatedAt,
    filters,
    matchedRuns,
    ...(excludedSingleRunGroups > 0 ? { excludedSingleRunGroups } : {}),
    ...(deepLink ? { deepLink } : {}),
    results: rows.map((row, i) => ({
      rank: i + 1,
      rig: row.rig || null,
      modelFamily: row.modelFamily || null,
      exampleModel: row.exampleModel || null,
      engine: row.engine || null,
      quantization: row.quantization || null,
      medianDecodeTokPerSec: round4(row.medianDecodeTokPerSec),
      medianPrefillTokPerSec: round4(row.medianPrefillTokPerSec),
      bestDecodeTokPerSec: round4(row.bestDecodeTokPerSec),
      runsInGroup: row.runsInGroup ?? null,
      singleRunGroup: (row.runsInGroup ?? 0) < 2,
      source: row.source || null
    }))
  };
}

/** One `|`-table row per rig, mirroring the card fields in rank order. */
export function buildShortlistMarkdown({ rows, filters = {}, matchedRuns = 0, excludedSingleRunGroups = 0, generatedAt = new Date().toISOString() }) {
  const lines = [];
  lines.push('# Find HW — ranked hardware shortlist');
  lines.push('');
  lines.push(`Generated: ${generatedAt} · ${rows.length} rig${rows.length === 1 ? '' : 's'} · ranked by median decode tok/s${matchedRuns ? ` · ${matchedRuns} runs scanned` : ''}`);
  if (Object.keys(filters).length > 0) {
    lines.push(`Filters: ${Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  if (excludedSingleRunGroups > 0) {
    lines.push(`Excluded ${excludedSingleRunGroups} single-run group${excludedSingleRunGroups === 1 ? '' : 's'} (min sample size 2).`);
  }
  lines.push('');
  lines.push('| # | Rig | Model family | Engine · quant | Median decode tok/s | Median prefill tok/s | Runs |');
  lines.push('|---|-----|--------------|----------------|--------------------:|---------------------:|-----:|');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const n1 = r.singleRunCaveat ?? (Number.isFinite(r.runsInGroup) ? r.runsInGroup < 2 : true);
    lines.push(
      `| ${i + 1} | ${md(rigName(r))} | ${md(r.modelFamily || '—')}${n1 ? ' ⚠ n=1' : ''} | ${md(`${r.engine || '—'} · ${r.quantization || '—'}`)} | ${fmtNum(r.medianDecodeTokPerSec)} | ${fmtNum(r.medianPrefillTokPerSec)} | ${r.runsInGroup ?? '—'} |`
    );
  }
  lines.push('');
  lines.push('Medians are outlier-resistant; runsInGroup is the sample size. Source: LocalMaxxing community benchmark corpus via /api/best.');
  return lines.join('\n');
}

function rigName(row) {
  if (row.rig) return row.rig;
  const hwClass = (row.hwClass || '').toLowerCase();
  if (hwClass === 'unified' && row.chip) return `${row.chip}${row.unifiedMemoryGb ? ` ${row.unifiedMemoryGb}GB` : ''}`;
  if (row.gpu) {
    const count = row.gpuCount || 1;
    return `${count > 1 ? `${count}× ` : ''}${row.gpu}${row.vramGb ? ` ${row.vramGb}GB` : ''}`;
  }
  return row.cpu || row.hardware || 'Unknown system';
}

function md(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function fmtNum(v) {
  return Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—';
}

function round4(v) {
  if (!Number.isFinite(v)) return v;
  const f = 10 ** 4;
  return Math.round(v * f) / f;
}
