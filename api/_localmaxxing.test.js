import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from './_localmaxxing.js';

function run(i, decode, prefill = decode) {
  return {
    runId: `run-${i}`,
    modelFamily: 'llama',
    prefillTokPerSec: prefill,
    decodeTokPerSec: decode
  };
}

const byDecode = g => `${g.hardwareKey}|${g.modelFamily}`;
// 12 tight runs around 100 tok/s decode + one absurd outlier at 900.
const cohort = [
  run(1, 98), run(2, 99), run(3, 100), run(4, 100),
  run(5, 100), run(6, 101), run(7, 101), run(8, 102),
  run(9, 99), run(10, 100), run(11, 101), run(12, 100),
  run(13, 900, 4000) // lucky/buggy run
];

test('aggregate excludes runs beyond 3×MAD from cohort median by default', () => {
  const [g] = aggregate([{ ...cohort[0], hardwareKey: 'h', modelFamily: 'm' }, ...cohort.slice(1).map(r => ({ ...r, hardwareKey: 'h', modelFamily: 'm' }))], byDecode);
  assert.equal(g.runs, 13);
  assert.equal(g.excludedRuns, 1);
  assert.equal(g.sampleLabel, 'n=13, 1 excluded');
  // Trimmed median must sit with the tight cluster, not get dragged up.
  assert.equal(g.decode.median, 100);
  assert.ok(g.decode.max < 200, 'trimmed max should exclude the 900 outlier');
});

test('includeOutliers=true keeps every run in the stats', () => {
  const rows = cohort.map(r => ({ ...r, hardwareKey: 'h', modelFamily: 'm' }));
  const [g] = aggregate(rows, byDecode, { includeOutliers: true });
  assert.equal(g.runs, 13);
  assert.equal(g.excludedRuns, 0);
  assert.equal(g.sampleLabel, 'n=13');
  assert.equal(g.decode.max, 900);
});

test('bestRun comes from retained runs only when trimming', () => {
  const rows = cohort.map(r => ({ ...r, hardwareKey: 'h', modelFamily: 'm' }));
  const trimmed = aggregate(rows, byDecode)[0].bestRun;
  const all = aggregate(rows, byDecode, { includeOutliers: true })[0].bestRun;
  assert.equal(trimmed.decodeTokPerSec, 102);
  assert.equal(all.decodeTokPerSec, 900);
});

test('small cohorts are never trimmed', () => {
  const rows = [run(1, 10), run(2, 20), run(3, 300)].map(r => ({ ...r, hardwareKey: 'h', modelFamily: 'm' }));
  const [g] = aggregate(rows, byDecode);
  assert.equal(g.excludedRuns, 0);
  assert.equal(g.decode.median, 20);
});

test('degenerate spread (MAD = 0) trims nothing', () => {
  const rows = [run(1, 100), run(2, 100), run(3, 100), run(4, 100)].map(r => ({ ...r, hardwareKey: 'h', modelFamily: 'm' }));
  const [g] = aggregate(rows, byDecode);
  assert.equal(g.excludedRuns, 0);
  assert.equal(g.decode.median, 100);
});

test('trimming never leaves fewer than 4 retained runs', () => {
  // 5 clean runs + 3 extreme outliers: trimming is allowed (5 survive),
  // but a group where trimming would leave <4 must be skipped entirely.
  const rows = [run(1, 100), run(2, 100), run(3, 100), run(4, 100), run(5, 100)]
    .concat([run(6, 100000), run(7, 200000), run(8, 300000)])
    .map(r => ({ ...r, hardwareKey: 'h', modelFamily: 'm' }));
  const [g] = aggregate(rows, byDecode);
  assert.ok(g.runs - g.excludedRuns >= 4 || g.excludedRuns === 0);
});

test('excluded count is reported per group alongside n', () => {
  const a = cohort.map(r => ({ ...r, hardwareKey: 'rigA', modelFamily: 'm' }));
  const b = [run(1, 42), run(2, 43), run(3, 44), run(4, 45)].map(r => ({ ...r, hardwareKey: 'rigB', modelFamily: 'm' }));
  const groups = aggregate([...a, ...b], byDecode);
  const rigA = groups.find(g => g.key === 'rigA|m');
  const rigB = groups.find(g => g.key === 'rigB|m');
  assert.equal(rigA.sampleLabel, 'n=13, 1 excluded');
  assert.equal(rigB.sampleLabel, 'n=4');
});
