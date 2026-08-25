import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNS_COLUMNS, RUNS_DATASET_VERSION, toRunsCsv, runsCsvPreamble, buildRunsJsonPayload, CSV_BOM } from './_runs_dump.js';

// A full-index row as produced by getAllRunsRaw(): slim run + comparable tag.
const comparableRow = {
  runId: 1234,
  createdAt: '2026-07-30T18:22:41.000Z',
  comparable: true,
  modelFamily: 'qwen3-6-27b',
  modelId: 'unsloth/Qwen3.6-27B-MTP-GGUF',
  modelName: 'Qwen3.6 27B',
  paramsB: 27,
  hardwareKey: 'rtx-5060-ti-16gb',
  hardware: 'RTX 5060 Ti 16GB',
  hwClass: 'discrete_gpu',
  gpu: 'RTX 5060 Ti',
  gpuCount: 2,
  vramGb: 32,
  chip: null,
  unifiedMemoryGb: null,
  cpu: null,
  engine: 'llama.cpp',
  engineVersion: 'b6123',
  quantization: 'q4_k_m',
  prefillTokPerSec: 1200,
  decodeTokPerSec: 45,
  promptTokens: 2048,
  outputTokens: 512,
  contextLength: 8192,
  contextBand: '8k-32k',
  source: 'https://localmaxxing.com/en/runs/1234'
};

const nonComparableRow = {
  ...comparableRow,
  runId: 5678,
  comparable: false,
  prefillTokPerSec: null, // batched runs can lack usable per-stream speeds
  decodeTokPerSec: null
};

test('RUNS_COLUMNS covers every key on a full-index row', () => {
  const keys = new Set(RUNS_COLUMNS.map(c => c.key));
  for (const row of [comparableRow, nonComparableRow]) {
    for (const k of Object.keys(row)) {
      assert.ok(keys.has(k), `column missing for row key: ${k}`);
    }
  }
});

test('toRunsCsv emits header plus one row per run with matching cell counts', () => {
  const csv = toRunsCsv([comparableRow, nonComparableRow]);
  assert.ok(!csv.includes('\r'), 'CSV must be LF-only (see toCsv framing contract)');
  const lines = csv.split('\n');
  assert.equal(lines[0], RUNS_COLUMNS.map(c => c.key).join(','));
  assert.ok(csv.endsWith('\n'));
  for (const line of lines.slice(1, 3)) {
    assert.equal(line.split(',').length, RUNS_COLUMNS.length);
  }
  // comparable flag serializes as true/false literals
  assert.equal(lines[1].split(',')[2], 'true');
  assert.equal(lines[2].split(',')[2], 'false');
});

test('toRunsCsv escapes CSV-special values per RFC 4180', () => {
  const csv = toRunsCsv([{ ...comparableRow, hardware: 'Rig "X", modded' }]);
  assert.ok(csv.includes('"Rig ""X"", modded"'));
});

test('runsCsvPreamble is all #-comments and documents metadata + dictionary', () => {
  const preamble = runsCsvPreamble(9, '2026-08-23T00:00:00.000Z');
  assert.ok(!preamble.includes('\r'));
  assert.equal(CSV_BOM, '\ufeff');
  const lines = preamble.split('\n').filter(Boolean);
  assert.ok(lines.every(l => l.startsWith('#')));
  assert.ok(preamble.includes(`schema_version: ${RUNS_DATASET_VERSION}`));
  assert.ok(preamble.includes('rows: 9'));
  for (const c of RUNS_COLUMNS) {
    assert.ok(preamble.includes(`#   ${c.key}:`), `dictionary line missing for ${c.key}`);
  }
});

test('runsCsvPreamble reflects the active comparable filter', () => {
  assert.ok(runsCsvPreamble(1, 'x', { comparableFilter: 'true' }).includes('single-stream only'));
  assert.ok(runsCsvPreamble(1, 'x', { comparableFilter: 'false' }).includes('non-comparable runs only'));
  assert.ok(runsCsvPreamble(1, 'x', { comparableFilter: 'all' }).includes('every community-measured run'));
});

test('buildRunsJsonPayload shapes the dump envelope', () => {
  const rows = [comparableRow, nonComparableRow];
  const payload = buildRunsJsonPayload(rows, '2026-08-23T05:00:00.000Z', {
    totalRunCount: 5,
    comparableFilter: 'all'
  });
  assert.equal(payload.schemaVersion, RUNS_DATASET_VERSION);
  assert.equal(payload.generatedAt, '2026-08-23T05:00:00.000Z');
  assert.equal(payload.rowCount, 2);
  assert.equal(payload.totalRunCount, 5);
  assert.equal(payload.comparableFilter, 'all');
  assert.deepEqual(payload.dataDictionary.map(d => d.column), RUNS_COLUMNS.map(c => c.key));
  assert.deepEqual(payload.runs, rows);
});
