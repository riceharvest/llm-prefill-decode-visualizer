import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toRunsCsv,
  runsCsvPreamble,
  buildRunsJsonPayload,
  RUNS_COLUMNS,
  RUNS_DATASET_VERSION
} from './_runs_dump.js';

const comparableRun = {
  runId: 1234,
  modelFamily: 'qwen3-6-27b',
  hardwareKey: 'rtx-5060-ti-16gb',
  hardware: 'RTX 5060 Ti 16GB',
  hwClass: 'discrete_gpu',
  engine: 'llama.cpp',
  quantization: 'q4_k_m',
  prefillTokPerSec: 1200,
  decodeTokPerSec: 45,
  contextLength: 8192,
  contextBand: '8k-32k',
  engineVersion: 'b6282',
  comparable: true
};

const batchedRun = { ...comparableRun, runId: 5678, decodeTokPerSec: 310, comparable: false };

test('RUNS_COLUMNS extends the export schema with dump-only fields', () => {
  const extra = RUNS_COLUMNS.slice(-3).map(c => c.key);
  assert.deepEqual(extra, ['engineVersion', 'contextBand', 'comparable']);
});

test('toRunsCsv emits header plus one row per run, CRLF-delimited', () => {
  const csv = toRunsCsv([comparableRun, batchedRun]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], RUNS_COLUMNS.map(c => c.key).join(','));
  assert.ok(csv.endsWith('\r\n'));
  for (const line of lines.slice(1, 3)) {
    assert.equal(line.split(',').length, RUNS_COLUMNS.length);
  }
  // boolean serializes as its string form, not blank
  assert.ok(lines[1].includes(',true'));
  assert.ok(lines[2].includes(',false'));
});

test('runsCsvPreamble documents every column and the no-filter scope by default', () => {
  const preamble = runsCsvPreamble(9, '2026-08-23T00:00:00.000Z');
  const lines = preamble.split('\r\n');
  assert.ok(lines.filter(Boolean).every(l => l.startsWith('#')));
  assert.ok(preamble.includes(`schema_version: ${RUNS_DATASET_VERSION}`));
  assert.ok(preamble.includes('rows: 9'));
  assert.ok(preamble.includes('filter: none'));
  for (const c of RUNS_COLUMNS) assert.ok(preamble.includes(`${c.key}: ${c.type} —`));
});

test('runsCsvPreamble states the comparability filter when comparableOnly', () => {
  const preamble = runsCsvPreamble(4, '2026-08-23T00:00:00.000Z', { comparableOnly: true });
  assert.ok(preamble.includes('filter: comparable=true'));
});

test('buildRunsJsonPayload carries dictionary, version and runs with a comparable count', () => {
  const payload = buildRunsJsonPayload([comparableRun, batchedRun], '2026-08-23T00:00:00.000Z');
  assert.equal(payload.schemaVersion, RUNS_DATASET_VERSION);
  assert.equal(payload.rowCount, 2);
  assert.equal(payload.comparableOnly, false);
  assert.equal(payload.comparableCount, 1);
  assert.deepEqual(payload.dataDictionary.map(d => d.column), RUNS_COLUMNS.map(c => c.key));
  assert.deepEqual(payload.runs, [comparableRun, batchedRun]);
});

test('buildRunsJsonPayload marks comparable-only dumps and points at /api/export', () => {
  const payload = buildRunsJsonPayload([comparableRun], '2026-08-23T00:00:00.000Z', { comparableOnly: true });
  assert.equal(payload.comparableOnly, true);
  assert.equal(payload.comparableCount, undefined);
  assert.equal(payload.seeAlso, '/api/export?format=json');
});
