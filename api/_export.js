// Pure helpers for /api/export — column schema, CSV serialization, data dictionary.
// Kept free of req/res so the shape can be unit-tested without a server.

import { getAllRuns } from './_localmaxxing.js';

export const DATASET_VERSION = 1;

/**
 * Ordered column schema for the comparable-runs dataset.
 * `key` matches the slim run objects returned by getAllRuns().
 */
export const COLUMNS = [
  { key: 'runId', type: 'string', description: 'Upstream run identifier (localmaxxing.com run id)' },
  { key: 'modelFamily', type: 'string', description: 'Normalized base model family — collapses repo/quant/finetune variants (e.g. qwen3-6-27b)' },
  { key: 'modelId', type: 'string', description: 'Raw Hugging Face model id as submitted (org/repo)' },
  { key: 'modelName', type: 'string', description: 'Human-readable model display name' },
  { key: 'paramsB', type: 'number', description: 'Total parameter count in billions; empty when unknown' },
  { key: 'hardwareKey', type: 'string', description: 'Canonical hardware group key (groups identical rigs across runs)' },
  { key: 'hardware', type: 'string', description: 'Human-readable hardware group label' },
  { key: 'hwClass', type: 'string', description: 'Hardware class: discrete_gpu | unified | cpu_only' },
  { key: 'gpu', type: 'string', description: 'GPU model name; empty for CPU-only rigs' },
  { key: 'gpuCount', type: 'number', description: 'Number of GPUs in the rig (minimum 1)' },
  { key: 'vramGb', type: 'number', description: 'Total GPU VRAM in GB; empty for unified/CPU rigs' },
  { key: 'chip', type: 'string', description: 'Chip variant/family/vendor for unified-memory rigs' },
  { key: 'unifiedMemoryGb', type: 'number', description: 'Unified memory size in GB (Apple Silicon / similar); empty otherwise' },
  { key: 'cpu', type: 'string', description: 'CPU model for CPU-only rigs' },
  { key: 'engine', type: 'string', description: 'Inference engine name (llama.cpp, vLLM, MLX, ...)' },
  { key: 'quantization', type: 'string', description: 'Quantization scheme as reported (q4_k_m, 4bit, ...)' },
  { key: 'prefillTokPerSec', type: 'number', description: 'Measured prompt-processing (prefill) speed, tokens/second, rounded' },
  { key: 'decodeTokPerSec', type: 'number', description: 'Measured generation (decode) speed, tokens/second, rounded' },
  { key: 'promptTokens', type: 'number', description: 'Prompt length in tokens for the benchmark run' },
  { key: 'outputTokens', type: 'number', description: 'Generated length in tokens for the benchmark run' },
  { key: 'contextLength', type: 'number', description: 'Context length used for the run; empty when unreported' },
  { key: 'source', type: 'string', description: 'URL of the original run page on localmaxxing.com' },
  { key: 'contextBand', type: 'string', description: 'Context-length band id derived from contextLength (e.g. <=8k, 8k-32k); empty when the run reports no usable contextLength' },
  { key: 'createdAt', type: 'string', description: 'ISO-8601 timestamp of the upstream measurement; empty when unreported' },
  { key: 'engineVersion', type: 'string', description: 'Inference engine build/version as reported by the submitter; empty when unreported' },
  { key: 'batchSize', type: 'number', description: 'Batch size reported by the runner (1 = single-stream)' },
  { key: 'concurrency', type: 'number', description: 'Concurrent requests reported by the runner' },
  { key: 'numParallel', type: 'number', description: 'Parallel sequences reported by the runner' },
  { key: 'prefillTokPerSecExact', type: 'number', description: 'Unrounded measured prompt-processing speed (tok/s)' },
  { key: 'decodeTokPerSecExact', type: 'number', description: 'Unrounded measured decode speed (tok/s)' },
];

/** Escape a single CSV field per RFC 4180 (quote when needed, double inner quotes). */
export function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 BOM prepended to CSV exports: Excel on ANSI-locale Windows ignores
 * the Content-Type charset for double-clicked files and needs a BOM to render
 * the non-ASCII em-dashes in the `#` preamble correctly. */
export const CSV_BOM = '\ufeff';

/**
 * Serialize run objects to RFC 4180 CSV text (header + rows).
 *
 * Framing contract: LF (`\n`) line endings with a trailing terminator. LF
 * (instead of RFC 4180's CRLF) keeps naive `split('\n')` parsers free of
 * `\r` pollution in the last column; lenient RFC 4180 parsers accept LF.
 */
export function toCsv(rows) {
  const header = COLUMNS.map(c => c.key).join(',');
  const lines = [header];
  for (const r of rows) {
    lines.push(COLUMNS.map(c => csvEscape(r[c.key])).join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Leading `#`-comment block for the CSV: metadata + one dictionary line per column.
 * Parsers can skip lines starting with `#` to get clean tabular data.
 */
export function csvPreamble(rowCount, generatedAt) {
  const lines = [
    `# dataset: localmaxxing comparable single-stream LLM benchmark runs`,
    `# schema_version: ${DATASET_VERSION}`,
    `# generated_at: ${generatedAt}`,
    `# rows: ${rowCount}`,
    `# filter: batchSize=1, single-stream (concurrency/numParallel <= 1), prefill and decode speeds > 0`,
    `# data dictionary (column: type — description):`
  ];
  for (const c of COLUMNS) lines.push(`#   ${c.key}: ${c.type} — ${c.description}`);
  lines.push(`# source: https://localmaxxing.com — exported via /api/export`);
  return lines.join('\n') + '\n';
}

/** JSON export envelope with the same dictionary in structured form. */
export function buildJsonPayload(rows, generatedAt) {
  return {
    description: 'Full comparable dataset: community-measured single-stream LLM benchmark runs (batchSize=1, concurrency<=1).',
    schemaVersion: DATASET_VERSION,
    generatedAt,
    rowCount: rows.length,
    dataDictionary: COLUMNS.map(c => ({ column: c.key, type: c.type, description: c.description })),
    runs: rows
  };
}

/** Load the full comparable dataset (cached upstream fetch). */
export async function loadDataset() {
  return getAllRuns();
}
