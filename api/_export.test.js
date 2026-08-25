import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, toCsv, csvPreamble, buildJsonPayload, COLUMNS, DATASET_VERSION, CSV_BOM } from './_export.js';

const sample = {
  runId: 1234,
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
  quantization: 'q4_k_m',
  prefillTokPerSec: 1200,
  decodeTokPerSec: 45,
  promptTokens: 2048,
  outputTokens: 512,
  contextLength: 8192,
  source: 'https://localmaxxing.com/en/runs/1234'
};

test('csvEscape quotes fields containing commas, quotes, newlines', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape(42), '42');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('line\nbreak'), '"line\nbreak"');
});

test('toCsv emits schema header plus one row per run, LF-delimited with trailing terminator', () => {
  const csv = toCsv([sample, { ...sample, runId: 5678 }]);
  assert.ok(!csv.includes('\r'), 'CSV must be LF-only so naive split("\\n") parsers see clean cells');
  const lines = csv.split('\n');
  assert.equal(lines[0], COLUMNS.map(c => c.key).join(','));
  assert.equal(lines.length, 4); // header + 2 rows + trailing empty from final LF
  assert.ok(csv.endsWith('\n'));
  const cells = lines[1].split(',');
  assert.equal(cells[0], '1234');
  assert.equal(cells[1], 'qwen3-6-27b');
  // every row has exactly as many cells as the header
  for (const line of lines.slice(1, 3)) {
    assert.equal(line.split(',').length, COLUMNS.length);
  }
});

test('CSV_BOM is the UTF-8 BOM', () => {
  assert.equal(CSV_BOM, '\ufeff');
});

test('csvPreamble documents every column and dataset metadata', () => {
  const preamble = csvPreamble(7, '2026-08-21T00:00:00.000Z');
  assert.ok(!preamble.includes('\r'));
  const lines = preamble.split('\n');
  assert.ok(lines.filter(Boolean).every(l => l.startsWith('#')));
  assert.ok(preamble.includes(`schema_version: ${DATASET_VERSION}`));
  assert.ok(preamble.includes('rows: 7'));
  for (const c of COLUMNS) assert.ok(preamble.includes(`${c.key}: ${c.type} —`));
});

test('buildJsonPayload carries dictionary, version and runs', () => {
  const payload = buildJsonPayload([sample], '2026-08-21T00:00:00.000Z');
  assert.equal(payload.schemaVersion, DATASET_VERSION);
  assert.equal(payload.rowCount, 1);
  assert.deepEqual(payload.dataDictionary.map(d => d.column), COLUMNS.map(c => c.key));
  assert.deepEqual(payload.runs, [sample]);
});
