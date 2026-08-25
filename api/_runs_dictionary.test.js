// /api/runs dataDictionary accuracy pins (#482): the dictionary must describe
// the values actually shipped (UPPERCASE hwClass, zero-vs-null speed
// semantics, promptTokens 0-when-unreported).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RUNS_COLUMNS, buildRunsJsonPayload } from './_runs_dump.js';

function desc(key) {
  const c = RUNS_COLUMNS.find(c => c.key === key);
  assert.ok(c, `column ${key} missing from RUNS_COLUMNS`);
  return c.description;
}

test('hwClass dictionary documents the UPPERCASE wire enum + write-path casing (#482)', () => {
  const d = desc('hwClass');
  assert.match(d, /DISCRETE_GPU/);
  assert.match(d, /CPU_ONLY/);
  // and tells agents about the lowercase submit validation so round-trips work
  assert.match(d, /discrete_gpu/);
});

test('speed columns document that shipped 0 means unusable like null (#482)', () => {
  for (const key of ['prefillTokPerSec', 'decodeTokPerSec']) {
    const d = desc(key);
    assert.match(d, /null when invalid\/absent/);
    assert.match(d, /0 as unusable|treat 0/, `${key} must warn about zeros`);
  }
});

test('promptTokens dictionary declares 0 = unreported (#482)', () => {
  assert.match(desc('promptTokens'), /0 when unreported/);
});

test('dictionary stays structurally intact after the wording fixes', () => {
  const payload = buildRunsJsonPayload([{ runId: 'x', hwClass: 'CPU_ONLY' }], '2026-01-01T00:00:00Z', { totalRunCount: 1, comparableCount: 1 });
  assert.equal(payload.rowCount, 1);
  assert.equal(payload.dataDictionary.length, RUNS_COLUMNS.length);
  for (const entry of payload.dataDictionary) {
    assert.ok(entry.column && entry.type && typeof entry.description === 'string');
  }
});
