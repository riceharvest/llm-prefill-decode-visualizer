import { test } from 'node:test';
import assert from 'node:assert/strict';

// #988 — KV-cache VRAM source-of-truth helpers: the memory ledger and the
// budget planner must resolve ?gpu=/?vram= with ONE precedence (explicit
// override wins) and every GPU picker must keep id + capacity in sync.
const { resolveBudgetVramGb, gpuSelectionPatch } = await import('./kvGpuState.js');

const A100 = { id: 'a100', vramGb: 80 };
const R4090 = { id: 'rtx4090', vramGb: 24 };
const CATALOG = [A100, R4090];

test('resolveBudgetVramGb: explicit ledger override beats gpu preset capacity', () => {
  // The exact contradictory pair from #988: gpu=a100&vram=24 must give BOTH
  // panels 24 GB, not ledger 24 / planner 80.
  assert.equal(resolveBudgetVramGb(A100, 24), 24);
  assert.equal(resolveBudgetVramGb(A100, 80), 80);
});

test('resolveBudgetVramGb: falls back to preset capacity when no override is set', () => {
  assert.equal(resolveBudgetVramGb(A100, NaN), 80);
  assert.equal(resolveBudgetVramGb(R4090, undefined), 24);
});

test('resolveBudgetVramGb: invalid override values never win', () => {
  assert.equal(resolveBudgetVramGb(A100, 0), 80);
  assert.equal(resolveBudgetVramGb(A100, -5), 80);
  assert.equal(resolveBudgetVramGb(A100, 'garbage'), 80);
});

test('resolveBudgetVramGb: no catalog GPU selected -> null verdict input', () => {
  // Manual ledger edits clear the preset id; verdict becomes unknown.
  assert.equal(resolveBudgetVramGb(null, 24), null);
  assert.equal(resolveBudgetVramGb(null, NaN), null);
});

test('gpuSelectionPatch: selecting a preset syncs id AND capacity (#988 one-sided-picker fix)', () => {
  assert.deepEqual(gpuSelectionPatch('a100', CATALOG), { gpuId: 'a100', gpuVramGb: 80 });
  assert.deepEqual(gpuSelectionPatch('rtx4090', CATALOG), { gpuId: 'rtx4090', gpuVramGb: 24 });
});

test('gpuSelectionPatch: clearing or unknown ids clear only the id (custom VRAM kept)', () => {
  assert.deepEqual(gpuSelectionPatch('', CATALOG), { gpuId: '' });
  assert.deepEqual(gpuSelectionPatch('nope404', CATALOG), { gpuId: 'nope404' });
});
