// #746 — /api/export schema honesty: the JSON rows (slim()) carry exactly the
// fields the payload's own dataDictionary documents, and the CSV serializes
// the same column set. Guards against dictionary-vs-payload drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, toCsv, csvPreamble, buildJsonPayload } from './_export.js';
import { slim } from './_localmaxxing.js';

const SAMPLE = {
  id: 'abc123',
  createdAt: '2026-08-01T00:00:00Z',
  model: { hfId: 'org/repo', displayName: 'Repo', params: 7 },
  hardwareGroupKey: 'rtx4090',
  hardwareGroupLabel: 'RTX 4090',
  hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
  engine: { engineName: 'llama.cpp', engineVersion: 'b4123', quantization: 'q4_k_m' },
  tokSPrefill: 3800.4,
  tokSOut: 105.6,
  promptTokens: 2048,
  outputTokens: 512,
  contextLength: 8192
};

test('slim() row keys are exactly the documented COLUMNS (#746)', () => {
  const row = slim(SAMPLE);
  const rowKeys = Object.keys(row).sort();
  const dictKeys = COLUMNS.map(c => c.key).sort();
  assert.deepEqual(rowKeys, dictKeys);
});

test('the three previously-undocumented fields are in the dictionary', () => {
  const keys = COLUMNS.map(c => c.key);
  for (const k of ['contextBand', 'createdAt', 'engineVersion']) {
    assert.ok(keys.includes(k), `dataDictionary missing ${k}`);
  }
  assert.equal(COLUMNS.length, Object.keys(slim(SAMPLE)).length);
});

test('contextBand derives a band id from contextLength', () => {
  const row = slim(SAMPLE);
  assert.ok(typeof row.contextBand === 'string' && row.contextBand.length > 0);
});

test('CSV header carries every dictionary column (JSON ≡ CSV dataset)', () => {
  const rows = [slim(SAMPLE)];
  const header = toCsv(rows).split('\r\n')[0].split(',');
  assert.deepEqual(header, COLUMNS.map(c => c.key));
});

test('CSV preamble dictionary documents all columns', () => {
  const pre = csvPreamble(1, '2026-08-24T00:00:00Z');
  for (const c of COLUMNS) {
    assert.ok(pre.includes(`#   ${c.key}:`), `preamble missing ${c.key}`);
  }
});

test('JSON envelope dataDictionary matches row keys', () => {
  const rows = [slim(SAMPLE)];
  const payload = buildJsonPayload(rows, '2026-08-24T00:00:00Z');
  assert.equal(payload.dataDictionary.length, COLUMNS.length);
  assert.deepEqual(
    payload.dataDictionary.map(d => d.column),
    COLUMNS.map(c => c.key)
  );
});
