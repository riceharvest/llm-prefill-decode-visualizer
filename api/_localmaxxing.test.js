import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, flagOutliers, DEFAULT_OUTLIER_IQRS } from './_localmaxxing.js';

// Synthetic runs shaped like the slim() output: batch=1, both speeds finite.
function run(id, prefill, decode, extra = {}) {
  return {
    runId: id,
    modelFamily: extra.modelFamily || 'llama-3-8b',
    hardwareKey: extra.hardwareKey || 'rtx-4090',
    hardware: 'RTX 4090',
    engine: 'llama.cpp',
    quantization: 'q4_k_m',
    prefillTokPerSec: prefill,
    decodeTokPerSec: decode,
    source: `https://localmaxxing.com/en/runs/${id}`,
    ...extra
  };
}

// A realistic group: 8 healthy rigs clustered tightly, plus optional junk.
function healthyGroup() {
  const prefills = [3900, 3950, 4000, 4050, 4100, 4150, 4200, 4250];
  const decodes = [105, 106, 107, 108, 109, 110, 111, 112];
  return prefills.map((p, i) => run(`h${i}`, p, decodes[i]));
}

const KEY = r => `${r.hardwareKey}|${r.modelFamily}`;

test('DEFAULT_OUTLIER_IQRS matches the issue spec (2.5)', () => {
  assert.equal(DEFAULT_OUTLIER_IQRS, 2.5);
});

test('a misconfigured rig far from its group median gets flagged with a deviation field', () => {
  const group = [...healthyGroup(), run('bad', 4000, 20)]; // decode collapsed, prefill sane
  const outliers = flagOutliers(group);
  assert.equal(outliers.length, 1);
  const o = outliers[0];
  assert.equal(o.runId, 'bad');
  assert.ok(o.maxIqrDeviations > 2.5, `expected deviation > 2.5, got ${o.maxIqrDeviations}`);
  assert.ok(o.decodeIqrDeviations > 2.5);
  assert.deepEqual(o.fields, ['decode']);
  assert.equal(o.source, 'https://localmaxxing.com/en/runs/bad');
  assert.equal(o.engine, 'llama.cpp');
});

test('a run can be flagged on prefill alone, and fields lists every tripped metric', () => {
  const group = [...healthyGroup(), run('slowprefill', 400, 108)]; // prefill collapsed, decode fine
  const [o] = flagOutliers(group);
  assert.equal(o.runId, 'slowprefill');
  assert.deepEqual(o.fields, ['prefill']);
  assert.ok(o.prefillIqrDeviations > 2.5);
  assert.equal(o.decodeIqrDeviations, 0);
});

test('normal runs within the fence are never flagged', () => {
  assert.deepEqual(flagOutliers(healthyGroup()), []);
});

test('aggregate attaches the outlier report to each group by default', () => {
  const groups = aggregate([...healthyGroup(), run('bad', 4000, 20)], KEY);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.runs, 9);
  assert.equal(g.outliers.length, 1);
  assert.equal(g.outliers[0].runId, 'bad');
  assert.equal(g.outlierIqrs, 2.5);
  assert.equal(g.includeOutliers, true);
  // default keeps every run in the stats (backward-compatible behavior)
  assert.equal(g.runsInStats, 9);
  assert.equal(g.outliersExcludedFromStats, 0);
  assert.equal(g.decode.max, 112);
});

test('includeOutliers:false excludes flagged runs from the stats but keeps them queryable', () => {
  const runs = [...healthyGroup(), run('bad', 4000, 20)];
  const [excluded] = aggregate(runs, KEY, { includeOutliers: false });
  assert.equal(excluded.runs, 9); // raw data still accounted for
  assert.equal(excluded.runsInStats, 8);
  assert.equal(excluded.outliersExcludedFromStats, 1);
  assert.equal(excluded.decode.median, 108.5); // median of the 8 healthy runs
  assert.equal(excluded.decode.min, 105); // misconfigured rig no longer drags the range
  assert.equal(excluded.outliers.length, 1); // raw run preserved for review
  assert.equal(excluded.outliers[0].decodeTokPerSec, 20);

  // and the default still matches the legacy all-runs stats
  const [included] = aggregate(runs, KEY);
  assert.equal(included.decode.min, 20);
  assert.ok(included.decode.median < excluded.decode.median);
});

test('a tighter threshold flags more runs', () => {
  const group = healthyGroup();
  assert.deepEqual(flagOutliers(group, 2.5), []);
  const strict = flagOutliers(group, 0.5);
  assert.ok(strict.length > 0);
  assert.ok(strict.every(o => o.maxIqrDeviations > 0.5));
});

test('zero-IQR groups never flag, so quantized/identical data does not mass-flag', () => {
  const group = [
    run('a', 4000, 100),
    run('b', 4000, 100),
    run('c', 4000, 100),
    run('d', 4000, 100),
    run('e', 4000, 100)
  ];
  assert.deepEqual(flagOutliers(group), []);
});

test('empty groups and invalid thresholds are safe', () => {
  assert.deepEqual(flagOutliers([], 2.5), []);
  assert.deepEqual(flagOutliers([run('a', 100, 10)], -1), []);
  assert.deepEqual(aggregate([], KEY), []);
});

test('groups sort by decode median after outlier exclusion', () => {
  const runs = [
    ...[110, 112, 114, 116, 118].map((d, i) => run(`r1-${i}`, 4000, d, { hardwareKey: 'rig-1' })),
    run('r1-bad', 4000, 500, { hardwareKey: 'rig-1' }), // inflates rig-1 when included
    ...[90, 92, 94, 96, 98].map((d, i) => run(`r2-${i}`, 4000, d, { hardwareKey: 'rig-2' }))
  ];
  const [top, second] = aggregate(runs, r => r.hardwareKey, { includeOutliers: false });
  assert.equal(top.key, 'rig-1'); // still fastest once the outlier is excluded
  assert.equal(second.key, 'rig-2');
  assert.equal(top.outliers[0].runId, 'r1-bad');
});

test('tied medians break deterministically on group key regardless of insertion order (#793)', () => {
  const mk = (hw, decode) => [decode - 1, decode, decode + 1]
    .map((d, i) => run(`${hw}-${i}`, 4000, d, { hardwareKey: hw }));
  // Same three tied-median groups, inserted in opposite orders.
  const asc = aggregate([...mk('aaa-rig', 100), ...mk('mmm-rig', 100), ...mk('zzz-rig', 100)], KEY);
  const desc = aggregate([...mk('zzz-rig', 100), ...mk('mmm-rig', 100), ...mk('aaa-rig', 100)], KEY);
  assert.deepEqual(asc.map(g => g.key), ['aaa-rig|llama-3-8b', 'mmm-rig|llama-3-8b', 'zzz-rig|llama-3-8b']);
  assert.deepEqual(desc.map(g => g.key), ['aaa-rig|llama-3-8b', 'mmm-rig|llama-3-8b', 'zzz-rig|llama-3-8b']);
});
