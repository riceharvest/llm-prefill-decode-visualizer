import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUtilizationPct, stackedLedgerBarAria } from './kvLedgerA11y.js';

test('#788 formatUtilizationPct rounds the 6-decimal ledger float to 1 decimal', () => {
  // Raw value reproduced from api/_math.js memoryLedger round() output
  assert.equal(formatUtilizationPct(672.678894), '672.7');
  assert.equal(formatUtilizationPct(41.666667), '41.7');
  assert.equal(formatUtilizationPct(100), '100');
  assert.equal(formatUtilizationPct(0), '0');
  assert.equal(formatUtilizationPct(99.98), '100');
});

test('#788 formatUtilizationPct falls back to the em-dash placeholder like the ledger rows', () => {
  assert.equal(formatUtilizationPct(null), '—');
  assert.equal(formatUtilizationPct(undefined), '—');
  assert.equal(formatUtilizationPct(NaN), '—');
  assert.equal(formatUtilizationPct('—'), '—');
  assert.equal(formatUtilizationPct(Infinity), '—');
});

test('#777 stackedLedgerBarAria composes segment labels into one accessible name', () => {
  const name = stackedLedgerBarAria(
    [
      { label: 'Weights', value: '40.0 GB' },
      { label: 'KV cache', value: '8.2 GB' },
      { label: 'Overhead 15%', value: '7.2 GB' }
    ],
    'GPU limit · 80 GB'
  );
  assert.equal(name, 'Weights 40.0 GB, KV cache 8.2 GB, Overhead 15% 7.2 GB — GPU limit · 80 GB');
});

test('#777 stackedLedgerBarAria tolerates missing segments and omitted limit label', () => {
  assert.equal(stackedLedgerBarAria([{ label: 'Only', value: '1 GB' }]), 'Only 1 GB');
  assert.equal(stackedLedgerBarAria([{ label: 'A' }, null, { value: 'x' }], 'Limit'), 'A — Limit');
  assert.equal(stackedLedgerBarAria([], 'Limit'), ' — Limit');
  assert.equal(stackedLedgerBarAria(undefined), '');
});
