// Pure helpers for GET /api/runs — the machine-readable dump of the FULL run
// index (comparable AND non-comparable runs). Kept free of req/res so the
// shapes can be unit-tested without a server. Mirrors ./_export.js, which
// covers the comparable-only /api/export dataset.
//
// Consumers:
//   - ?format=json  → buildRunsJsonPayload(): envelope + structured dictionary
//   - ?format=csv   → runsCsvPreamble() + toRunsCsv() (RFC 4180, #-preamble)

import { CSV_BOM, csvEscape } from './_export.js';

export const RUNS_DATASET_VERSION = 1;

/**
 * Ordered column schema for the full-run dump. `key` matches the slim run
 * objects returned by getAllRunsRaw(); `comparable` lets consumers apply (or
 * skip) the same single-stream filter the aggregate endpoints use.
 */
export const RUNS_COLUMNS = [
  { key: 'runId', type: 'string', description: 'Upstream run identifier (localmaxxing.com run id)' },
  { key: 'createdAt', type: 'string', description: 'ISO timestamp when the run was recorded; null when unreported' },
  { key: 'comparable', type: 'boolean', description: 'true when the run passes the single-stream filter (batchSize=1, concurrency<=1, both speeds > 0) used by the aggregate endpoints' },
  { key: 'modelFamily', type: 'string', description: 'Normalized base model family — collapses repo/quant/finetune variants (e.g. qwen3-6-27b)' },
  { key: 'modelId', type: 'string', description: 'Raw Hugging Face model id as submitted (org/repo)' },
  { key: 'modelName', type: 'string', description: 'Human-readable model display name' },
  { key: 'paramsB', type: 'number', description: 'Total parameter count in billions; empty when unknown' },
  { key: 'hardwareKey', type: 'string', description: 'Canonical hardware group key (groups identical rigs across runs)' },
  { key: 'hardware', type: 'string', description: 'Human-readable hardware group label' },
  { key: 'hwClass', type: 'string', description: 'Hardware class as shipped on this read path: DISCRETE_GPU | UNIFIED | CPU_ONLY (UPPERCASE). Note: POST /api/localmaxxing submission validation accepts the lowercase spellings discrete_gpu | unified | cpu_only — lowercase the value before echoing it back on a submit.' },
  { key: 'gpu', type: 'string', description: 'GPU model name; empty for CPU-only rigs' },
  { key: 'gpuCount', type: 'number', description: 'Number of GPUs in the rig (minimum 1)' },
  { key: 'vramGb', type: 'number', description: 'Total GPU VRAM in GB; empty for unified/CPU rigs' },
  { key: 'chip', type: 'string', description: 'Chip variant/family/vendor for unified-memory rigs' },
  { key: 'unifiedMemoryGb', type: 'number', description: 'Unified memory size in GB (Apple Silicon / similar); empty otherwise' },
  { key: 'cpu', type: 'string', description: 'CPU model for CPU-only rigs' },
  { key: 'engine', type: 'string', description: 'Inference engine name (llama.cpp, vLLM, MLX, ...)' },
  { key: 'engineVersion', type: 'string', description: 'Engine version as reported; null when unreported' },
  { key: 'quantization', type: 'string', description: 'Quantization scheme as reported (q4_k_m, 4bit, ...)' },
  { key: 'prefillTokPerSec', type: 'number', description: 'Measured prompt-processing (prefill) speed, tokens/second, rounded; null when invalid/absent (possible on non-comparable runs); 0 when the run was reported with a zero speed — treat 0 as unusable, same as null' },
  { key: 'decodeTokPerSec', type: 'number', description: 'Measured generation (decode) speed, tokens/second, rounded; null when invalid/absent (possible on non-comparable runs); 0 when the run was reported with a zero speed — treat 0 as unusable, same as null' },
  { key: 'promptTokens', type: 'number', description: 'Prompt length in tokens for the benchmark run; 0 when unreported (indistinguishable from a true zero-token prompt — do not treat 0 as a measured workload)' },
  { key: 'outputTokens', type: 'number', description: 'Generated length in tokens for the benchmark run' },
  { key: 'contextLength', type: 'number', description: 'Context length used for the run; empty when unreported' },
  { key: 'contextBand', type: 'string', description: 'Context-length band id (lt1k, 1k-8k, 8k-32k, 32k+); null when contextLength is unusable' },
  { key: 'source', type: 'string', description: 'URL of the original run page on localmaxxing.com' }
];

/**
 * Serialize full-index run objects to RFC 4180 CSV text (header + rows).
 * Framing contract matches ./_export.js: LF line endings, trailing terminator
 * (see toCsv for why LF instead of CRLF). Re-exports CSV_BOM for handlers.
 */
export { CSV_BOM };

export function toRunsCsv(rows) {
  const header = RUNS_COLUMNS.map(c => c.key).join(',');
  const lines = [header];
  for (const r of rows) {
    lines.push(RUNS_COLUMNS.map(c => csvEscape(r[c.key])).join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Leading `#`-comment block for the CSV: metadata + one dictionary line per
 * column. Parsers can skip lines starting with `#` to get clean tabular data.
 */
export function runsCsvPreamble(rowCount, generatedAt, { comparableFilter = 'all' } = {}) {
  const filterText = {
    all: 'none — every community-measured run (use the `comparable` column)',
    true: 'single-stream only (batchSize=1, concurrency/numParallel <= 1, prefill and decode speeds > 0)',
    false: 'non-comparable runs only (`comparable` column is false)'
  }[comparableFilter] || filterTextFallback(comparableFilter);
  const lines = [
    `# dataset: localmaxxing full LLM benchmark run index`,
    `# schema_version: ${RUNS_DATASET_VERSION}`,
    `# generated_at: ${generatedAt}`,
    `# rows: ${rowCount}`,
    `# filter: ${filterText}`,
    `# data dictionary (column: type — description):`
  ];
  for (const c of RUNS_COLUMNS) lines.push(`#   ${c.key}: ${c.type} — ${c.description}`);
  lines.push(`# source: https://localmaxxing.com — exported via /api/runs`);
  return lines.join('\n') + '\n';
}

function filterTextFallback(mode) {
  return `comparable=${mode}`;
}

/** JSON dump envelope with the same dictionary in structured form. */
export function buildRunsJsonPayload(rows, generatedAt, { totalRunCount, comparableCount, comparableFilter = 'all' } = {}) {
  return {
    description: 'Full machine-readable dump of the community-measured LLM benchmark run index, including batched/non-comparable runs. Filter client-side with the `comparable` flag to reproduce the single-stream dataset the aggregate endpoints use.',
    schemaVersion: RUNS_DATASET_VERSION,
    generatedAt,
    comparableFilter,
    totalRunCount,
    comparableCount,
    rowCount: rows.length,
    dataDictionary: RUNS_COLUMNS.map(c => ({ column: c.key, type: c.type, description: c.description })),
    runs: rows
  };
}
