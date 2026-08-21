import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_BANDS,
  CONTEXT_BAND_IDS,
  contextBandOf,
  parseContextBandParam,
  filterByContextBand,
  contextBandMix
} from './_contextbands.js';
import { aggregate } from './_localmaxxing.js';
import { ApiError } from './_errors.js';

const run = (id, contextLength) => ({
  runId: id,
  contextLength,
  contextBand: contextBandOf(contextLength)?.id ?? null,
  prefillTokPerSec: 1000 + (id % 7) * 10,
  decodeTokPerSec: 50 + (id % 5)
});

test('band table: four ordered bands <1k / 1k–8k / 8k–32k / 32k+', () => {
  assert.deepEqual(CONTEXT_BAND_IDS, ['lt1k', '1k-8k', '8k-32k', '32k+']);
  assert.deepEqual(CONTEXT_BANDS.map(b => b.label), ['<1k', '1k–8k', '8k–32k', '32k+']);
  // bands are contiguous and non-overlapping
  for (let i = 1; i < CONTEXT_BANDS.length; i++) {
    assert.equal(CONTEXT_BANDS[i].min, CONTEXT_BANDS[i - 1].max);
  }
});

test('contextBandOf buckets boundary values into the right band', () => {
  assert.equal(contextBandOf(1).id, 'lt1k');
  assert.equal(contextBandOf(512).id, 'lt1k');
  assert.equal(contextBandOf(999).id, 'lt1k');
  assert.equal(contextBandOf(1000).id, '1k-8k');
  assert.equal(contextBandOf(4096).id, '1k-8k');
  assert.equal(contextBandOf(7999).id, '1k-8k');
  assert.equal(contextBandOf(8000).id, '8k-32k');
  assert.equal(contextBandOf(8192).id, '8k-32k');
  assert.equal(contextBandOf(31999).id, '8k-32k');
  assert.equal(contextBandOf(32000).id, '32k+');
  assert.equal(contextBandOf(131072).id, '32k+');
});

test('contextBandOf returns null for missing or invalid lengths', () => {
  assert.equal(contextBandOf(null), null);
  assert.equal(contextBandOf(undefined), null);
  assert.equal(contextBandOf(0), null);
  assert.equal(contextBandOf(-4096), null);
  assert.equal(contextBandOf('not-a-number'), null);
  assert.equal(contextBandOf(NaN), null);
});

test('parseContextBandParam accepts ids and labels, rejects unknown values', () => {
  assert.equal(parseContextBandParam(undefined), null);
  assert.equal(parseContextBandParam(''), null);
  assert.equal(parseContextBandParam('lt1k'), 'lt1k');
  assert.equal(parseContextBandParam('1k-8k'), '1k-8k');
  assert.equal(parseContextBandParam('8k-32k'), '8k-32k');
  assert.equal(parseContextBandParam('32k+'), '32k+');
  // display-label aliases resolve to the same ids
  assert.equal(parseContextBandParam('<1k'), 'lt1k');
  assert.equal(parseContextBandParam('32k+'), '32k+');
  assert.throws(() => parseContextBandParam('bananas'), ApiError);
  assert.throws(() => parseContextBandParam('bananas'), /Unknown context_band/);
});

test('filterByContextBand keeps only runs in the band and drops unknowns', () => {
  const runs = [run(1, 512), run(2, 4096), run(3, 8192), run(4, 65536), run(5, null)];
  assert.equal(filterByContextBand(runs, null).length, 5); // no filter → passthrough
  assert.deepEqual(filterByContextBand(runs, 'lt1k').map(r => r.runId), [1]);
  assert.deepEqual(filterByContextBand(runs, '1k-8k').map(r => r.runId), [2]);
  assert.deepEqual(filterByContextBand(runs, '8k-32k').map(r => r.runId), [3]);
  assert.deepEqual(filterByContextBand(runs, '32k+').map(r => r.runId), [4]);
  // unknown contextLength never matches a band filter
  assert.deepEqual(filterByContextBand(runs, 'lt1k').filter(r => r.runId === 5), []);
});

test('contextBandMix reports counts, unknowns and the mixed flag', () => {
  const mixed = contextBandMix([run(1, 512), run(2, 4096), run(3, 8192), run(4, null)]);
  assert.equal(mixed.mixed, true);
  assert.equal(mixed.distinctBands, 3);
  assert.equal(mixed.unknownRuns, 1);
  assert.deepEqual(mixed.bands, [
    { band: 'lt1k', label: '<1k', runs: 1 },
    { band: '1k-8k', label: '1k–8k', runs: 1 },
    { band: '8k-32k', label: '8k–32k', runs: 1 }
  ]);

  const single = contextBandMix([run(1, 4096), run(2, 2048)]);
  assert.equal(single.mixed, false);
  assert.equal(single.distinctBands, 1);

  const empty = contextBandMix([]);
  assert.equal(empty.mixed, false);
  assert.equal(empty.distinctBands, 0);
  assert.deepEqual(empty.bands, []);

  const allUnknown = contextBandMix([run(1, null), run(2, undefined)]);
  assert.equal(allUnknown.mixed, false);
  assert.equal(allUnknown.unknownRuns, 2);
});

test('aggregate() annotates groups with the band mix and mixedContextBands', () => {
  // same hardware×model group, runs measured across two bands → mixed
  const groups = aggregate(
    [
      { ...run(1, 512), modelFamily: 'llama', hardwareKey: 'rig-a' },
      { ...run(2, 65536), modelFamily: 'llama', hardwareKey: 'rig-a' },
      { ...run(3, 2048), modelFamily: 'qwen', hardwareKey: 'rig-b' },
      { ...run(4, 4096), modelFamily: 'qwen', hardwareKey: 'rig-b' }
    ],
    r => `${r.hardwareKey}|${r.modelFamily}`
  );
  const byKey = new Map(groups.map(g => [g.key, g]));

  const mixedGroup = byKey.get('rig-a|llama');
  assert.equal(mixedGroup.mixedContextBands, true);
  assert.equal(mixedGroup.contextBands.distinctBands, 2);
  assert.deepEqual(mixedGroup.contextBands.bands.map(b => b.band), ['lt1k', '32k+']);

  const cleanGroup = byKey.get('rig-b|qwen');
  assert.equal(cleanGroup.mixedContextBands, false);
  assert.deepEqual(cleanGroup.contextBands.bands.map(b => b.band), ['1k-8k']);
});
