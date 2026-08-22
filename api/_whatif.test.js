import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optionKey, computeWhatIfDiff } from './_whatif.js';

// Synthetic ranked decision rows shaped like /api/best results
// (identity fields plus an optional vramFit estimate).
function mk(hardwareKey, modelFamily, overrides = {}) {
  return {
    hardwareKey,
    hardware: hardwareKey.toUpperCase(),
    modelFamily,
    exampleModel: `${modelFamily}-instruct`,
    quantization: 'q4_k_m',
    ...overrides
  };
}

test('optionKey is stable rig × family identity', () => {
  assert.equal(optionKey(mk('rtx4090', 'llama-3-8b')), 'rtx4090|llama-3-8b');
});

test('identical sets produce no deltas', () => {
  const rows = [mk('a', 'm1'), mk('b', 'm2')];
  const d = computeWhatIfDiff(rows, rows.slice());
  assert.deepEqual(d.counts, { aOnly: 0, bOnly: 0, shared: 2 });
  assert.equal(d.entered.length, 0);
  assert.equal(d.left.length, 0);
  assert.equal(d.headroom.length, 0);
  assert.match(d.summary, /no what-if deltas/);
});

test('options entering and leaving are detected order-independently', () => {
  const rowsA = [mk('a', 'm1'), mk('b', 'm2'), mk('c', 'm3')];
  const rowsB = [mk('c', 'm3'), mk('d', 'm4'), mk('a', 'm1'), mk('e', 'm5')];
  const d = computeWhatIfDiff(rowsA, rowsB);

  assert.deepEqual(d.counts, { aOnly: 1, bOnly: 2, shared: 2 });

  // left: in A only
  assert.equal(d.left.length, 1);
  assert.equal(d.left[0].key, 'b|m2');
  assert.equal(d.left[0].rankA, 2); // position in A's ranking

  // entered: in B only
  const enteredKeys = d.entered.map(o => o.key).sort();
  assert.deepEqual(enteredKeys, ['d|m4', 'e|m5']);
  assert.ok(d.entered.every(o => typeof o.rankB === 'number'));

  // shared options carry both ranks
  const shared = d.headroom.length; // no vramFit → headroom list empty
  assert.equal(shared, 0);
});

test('headroom deltas and fit flips are reported for shared options', () => {
  const rowsA = [
    mk('big', 'm1', { vramFit: { fits: false, headroomGb: -2.5 } }),
    mk('small', 'm2', { vramFit: { fits: true, headroomGb: 4.25 } }),
    mk('flat', 'm3', { vramFit: { fits: true, headroomGb: 8 } })
  ];
  const rowsB = [
    mk('big', 'm1', { vramFit: { fits: true, headroomGb: 1.5 } }),
    mk('small', 'm2', { vramFit: { fits: false, headroomGb: -1.75 } }),
    mk('flat', 'm3', { vramFit: { fits: true, headroomGb: 8 } })
  ];
  const d = computeWhatIfDiff(rowsA, rowsB);

  assert.equal(d.headroom.length, 3);
  assert.equal(d.headroom[0].key, 'small|m2'); // biggest |delta| first
  assert.equal(d.headroom[0].headroomDeltaGb, -6); // -1.75 − 4.25
  assert.equal(d.headroom[0].fitsA, true);
  assert.equal(d.headroom[0].fitsB, false);
  // flat option: zero delta, no flip → still listed but last
  const flat = d.headroom.find(h => h.key === 'flat|m3');
  assert.equal(flat.headroomDeltaGb, 0);

  assert.match(d.summary, /flip their estimated fit verdict/);
  assert.match(d.summary, /Largest headroom shift: SMALL \(m2\) loses 6 GB/);
});

test('shared options without any fit data are omitted from headroom', () => {
  const rowsA = [mk('a', 'm1')];
  const rowsB = [mk('a', 'm1', { quantization: 'q8_0' })];
  const d = computeWhatIfDiff(rowsA, rowsB);
  assert.equal(d.headroom.length, 0);
  assert.match(d.summary, /no what-if deltas/);
});

test('empty inputs are handled', () => {
  const d = computeWhatIfDiff([], []);
  assert.deepEqual(d.counts, { aOnly: 0, bOnly: 0, shared: 0 });
  assert.match(d.summary, /no what-if deltas/);
});
