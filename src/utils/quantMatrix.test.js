import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuantRows, paramsBillion, qualityNoteKey, weightsVramGb } from './quantMatrix.js';

// Shape mirrors GET /api/benchmarks?groupBy=quant rows for one model family:
// one group per hardware×quant cohort (same-engine by default).
function cohort(overrides = {}) {
  return {
    key: 'DISCRETE_GPU|RTX 3090|1|24|llama.cpp|Q4_K_M',
    runs: 3,
    mixedEngines: false,
    decode: { median: 40, ci95: [38, 42], label: '40 [38–42]' },
    confidence: { grade: 'A' },
    freshness: { staleness: 'fresh', newestRunAt: '2026-08-01T00:00:00Z' },
    bestRun: {
      runId: 'r1',
      hardware: 'RTX 3090',
      engine: 'llama.cpp',
      engineVersion: 'b6000',
      quantization: 'Q4_K_M',
      prefillTokPerSec: 1200,
      decodeTokPerSec: 45,
      createdAt: '2026-08-01T00:00:00Z'
    },
    ...overrides
  };
}

test('buildQuantRows collapses hardware×quant cohorts into one row per quant tag', () => {
  const rows = buildQuantRows([
    cohort(),
    cohort({ key: 'DISCRETE_GPU|RTX 4090|1|24|llama.cpp|Q4_K_M', bestRun: { quantization: 'Q4_K_M' }, decode: { median: 60 } }),
    cohort({ key: 'x|FP16', bestRun: { quantization: 'FP16' }, decode: { median: 25 } })
  ]);

  assert.deepEqual(rows.map(r => r.quant), ['FP16', 'Q4_K_M']); // highest bpw first
  const q4 = rows[1];
  assert.equal(q4.rigs, 2);
  assert.equal(q4.runs, 6);
  assert.equal(q4.medianDecode, 50); // median of [40, 60]
  assert.equal(q4.bpw, 4.85); // from the shared _quant table
});

test('buildQuantRows keeps the fastest cohort as the best measured run and its CI label', () => {
  const rows = buildQuantRows([
    cohort(),
    cohort({ key: 'x2', decode: { median: 60, label: '60 [55–65]' }, bestRun: { quantization: 'Q4_K_M', decodeTokPerSec: 66 } })
  ]);
  assert.equal(rows[0].best.decode.median, 60);
  assert.equal(rows[0].ciLabel, '60 [55–65]');
  assert.equal(rows[0].best.bestRun.decodeTokPerSec, 66);
});

test('buildQuantRows flags mixed engines and tolerates missing bestRun quantization', () => {
  const rows = buildQuantRows([
    cohort({ mixedEngines: true }),
    cohort({ bestRun: null }) // falls back to the key's last segment
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quant, 'Q4_K_M');
  assert.equal(rows[0].mixedEngines, true);
});

test('buildQuantRows merges case-variant quant tags and keeps the most common casing', () => {
  const rows = buildQuantRows([
    cohort({ key: 'a|fp16', bestRun: { quantization: 'fp16' } }),
    cohort({ key: 'b|FP16', bestRun: { quantization: 'FP16' } }),
    cohort({ key: 'c|FP16', bestRun: { quantization: 'FP16' } })
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quant, 'FP16');
  assert.equal(rows[0].rigs, 3);
});

test('buildQuantRows handles empty and malformed input', () => {
  assert.deepEqual(buildQuantRows([]), []);
  assert.deepEqual(buildQuantRows(undefined), []);
  const rows = buildQuantRows([{ key: '' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quant, 'Unknown');
});

test('paramsBillion parses size tokens out of family keys', () => {
  assert.equal(paramsBillion('llama-3-1-8b'), 8);
  assert.equal(paramsBillion('qwen3-6-35b-a3b'), 35);
  assert.equal(paramsBillion('gemma-4-12b'), 12);
  assert.equal(paramsBillion('mystery-model'), null);
  assert.equal(paramsBillion(''), null);
});

test('weightsVramGb is a weights-only estimate: params × bpw ÷ 8', () => {
  assert.equal(weightsVramGb('llama-3-1-8b', 16), 16); // FP16 8B ≈ 16 GB
  assert.equal(weightsVramGb('llama-3-1-8b', 4.85), 4.9); // Q4_K_M 8B ≈ 4.9 GB
  assert.equal(weightsVramGb('mystery-model', 16), null); // unknown params
});

test('qualityNoteKey tiers on bits-per-weight', () => {
  assert.equal(qualityNoteKey(16), 'quant.qualityNearLossless');
  assert.equal(qualityNoteKey(8), 'quant.qualityMinor');
  assert.equal(qualityNoteKey(4.85), 'quant.qualitySweetSpot');
  assert.equal(qualityNoteKey(2), 'quant.qualityNoticeable');
});
