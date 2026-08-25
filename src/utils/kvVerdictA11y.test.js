// #510 — KV-cache view a11y helpers: per-GPU verdict chips carry their verdict
// in the accessible name, and computed results are announced via one polite
// role=status summary instead of mutating silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuVerdictChipLabel, kvCacheLiveSummary } from './kvVerdictA11y.js';

const LABELS = {
  pass: 'PASS — fits with headroom',
  warn: 'TIGHT — over 90% used, OOM risk at peak usage',
  fail: 'OOM — exceeds VRAM'
};

test('gpuVerdictChipLabel folds the verdict into the accessible name (#510)', () => {
  assert.equal(
    gpuVerdictChipLabel({ name: 'RTX 5090', vramGb: 32, verdict: 'fail', verdictLabels: LABELS }),
    'RTX 5090 32GB — OOM — exceeds VRAM'
  );
  assert.equal(
    gpuVerdictChipLabel({ name: 'RTX 3060', vramGb: 12, verdict: 'pass', verdictLabels: LABELS }),
    'RTX 3060 12GB — PASS — fits with headroom'
  );
});

test('gpuVerdictChipLabel degrades gracefully without name or labels', () => {
  assert.equal(gpuVerdictChipLabel({ vramGb: 24 }), '24GB — verdict unknown');
  assert.equal(gpuVerdictChipLabel({ name: 'GPU X', verdict: 'warn', verdictLabels: LABELS }), 'GPU X — TIGHT — over 90% used, OOM risk at peak usage');
});

test('kvCacheLiveSummary summarizes the computed results in one line', () => {
  assert.equal(
    kvCacheLiveSummary({ kbPerToken: 96, totalGb: 12.58, gpuVramGb: 24, verdictLabel: 'PASS — fits with headroom' }),
    'KV cache 96 KB/token, total 12.58 GB, 24 GB target: PASS — fits with headroom'
  );
});

test('kvCacheLiveSummary omits missing pieces instead of printing NaN', () => {
  assert.equal(kvCacheLiveSummary({ kbPerToken: 96 }), 'KV cache 96 KB/token');
  assert.equal(kvCacheLiveSummary({}), '');
});
