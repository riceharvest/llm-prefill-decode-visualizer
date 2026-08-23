// Pure helpers for /api/runs — the machine-readable dump of the FULL run
// index (every community-measured run, comparable or not). Kept free of
// req/res so the shape can be unit-tested without a server.
//
// Difference vs /api/export: export serves only the *comparable* subset
// (batchSize=1, single-stream) for apples-to-apples math. /api/runs serves
// the complete upstream run index so agents/crawlers can consume everything
// without JS; each row carries a `comparable` boolean instead of pre-filtering.

import { csvEscape, COLUMNS } from './_export.js';
import { getAllRunsRaw, slimRun } from './_localmaxxing.js';

export const RUNS_DATASET_VERSION = 1;

/**
 * Column schema for the full-run-index dump. Extends the /api/export columns
 * with the fields that only matter when non-comparable runs are present.
 */
export const RUNS_COLUMNS = [
  ...COLUMNS.slice(0, 1),
  { key: 'createdAt', type: 'string', description: 'ISO-8601 submission timestamp of the run; empty when unreported' },
  ...COLUMNS.slice(1),
  { key: 'engineVersion', type: 'string', description: 'Inference engine version as reported (e.g. llama.cpp b4123); empty when unreported' },
  { key: 'contextBand', type: 'string', description: 'Context-length band: lt1k | 1k-8k | 8k-32k | 32k+ | empty when contextLength is unreported' },
  { key: 'comparable', type: 'boolean', description: 'Whether the run passes the comparability filter (batchSize=1, single-stream, positive speeds) used by /api/export and all aggregate endpoints' }
];

/** Serialize dump rows to RFC 4180 CSV text (header + rows, trailing newline). */
export function toRunsCsv(rows) {
  const header = RUNS_COLUMNS.map(c => c.key).join(',');
  const lines = [header];
  for (const r of rows) {
    lines.push(RUNS_COLUMNS.map(c => csvEscape(r[c.key])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * Leading `#`-comment block for the CSV: metadata + one dictionary line per column.
 * Parsers can skip lines starting with `#` to get clean tabular data.
 */
export function runsCsvPreamble(rowCount, generatedAt, { comparableOnly = false } = {}) {
  const filter = comparableOnly
    ? 'filter: comparable=true — batchSize=1, single-stream (concurrency/numParallel <= 1), prefill and decode speeds > 0'
    : 'filter: none — full upstream run index; each row carries a `comparable` flag';
  const lines = [
    `# dataset: localmaxxing community LLM benchmark runs (full index)`,
    `# schema_version: ${RUNS_DATASET_VERSION}`,
    `# generated_at: ${generatedAt}`,
    `# rows: ${rowCount}`,
    `# ${filter}`,
    `# data dictionary (column: type — description):`
  ];
  for (const c of RUNS_COLUMNS) lines.push(`#   ${c.key}: ${c.type} — ${c.description}`);
  lines.push(`# source: https://localmaxxing.com — exported via /api/runs`);
  return lines.join('\r\n') + '\r\n';
}

/** JSON dump envelope with the same dictionary in structured form. */
export function buildRunsJsonPayload(rows, generatedAt, { comparableOnly = false } = {}) {
  const payload = {
    description: comparableOnly
      ? 'Full dump restricted to comparable single-stream runs (batchSize=1, concurrency<=1) — same set as /api/export?format=json.'
      : 'Full run index dump: every community-measured LLM benchmark run, including batched/non-comparable ones. Each row carries a `comparable` flag; aggregate endpoints (/api/benchmarks, /api/best) use only rows where comparable=true.',
    schemaVersion: RUNS_DATASET_VERSION,
    generatedAt,
    rowCount: rows.length,
    comparableOnly,
    dataDictionary: RUNS_COLUMNS.map(c => ({ column: c.key, type: c.type, description: c.description })),
    runs: rows
  };
  if (comparableOnly) {
    payload.seeAlso = '/api/export?format=json';
  } else {
    payload.comparableCount = rows.filter(r => r.comparable).length;
  }
  return payload;
}

/** Load the full run index (cached upstream fetch), slimmed + tagged. */
export async function loadRunIndex() {
  return (await getAllRunsRaw()).map(slimRun);
}
