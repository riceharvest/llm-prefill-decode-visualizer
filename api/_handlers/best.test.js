import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankGroups } from './best.js';

// Minimal aggregate()-shaped group: only the fields rankGroups reads.
function group(hardwareKey, decodeMedian, extra = {}) {
  const run = {
    hardwareKey,
    modelFamily: extra.modelFamily || 'llama-3-8b',
    hardware: 'Rig',
    hwClass: 'discrete_gpu',
    modelName: 'llama-3-8b-q4',
    quantization: 'q4_k_m',
    engine: 'llama.cpp'
  };
  return {
    key: `${hardwareKey}|${run.modelFamily}`,
    runs: 3,
    bestRun: run,
    confidence: { score: extra.score ?? 50 },
    prefill: { median: 4000 },
    decode: { median: decodeMedian },
    ...extra.group
  };
}

test('rankGroups breaks tied medians on hardware|model regardless of insertion order (#793)', () => {
  const groups = [
    group('zzz-rig', 100),
    group('aaa-rig', 100),
    group('mmm-rig', 200) // genuinely faster, stays on top
  ];
  const reversed = [groups[0], groups[2], groups[1]];
  const expectedKeys = ['mmm-rig|llama-3-8b', 'aaa-rig|llama-3-8b', 'zzz-rig|llama-3-8b'];
  const a = rankGroups(groups, 'decode', null, 10).map(r => r.hardwareKey);
  const b = rankGroups(reversed, 'decode', null, 10).map(r => r.hardwareKey);
  assert.deepEqual(a, ['mmm-rig', 'aaa-rig', 'zzz-rig']);
  assert.deepEqual(b, ['mmm-rig', 'aaa-rig', 'zzz-rig']);
  assert.deepEqual(rankGroups(groups, 'decode', null, 10).map(r => `${r.hardwareKey}|${r.modelFamily}`), expectedKeys);
});

test('rankGroups ties break deterministically for prefill and walltime too (#793)', () => {
  const groups = [group('zzz-rig', 100), group('aaa-rig', 100)];
  for (const by of ['prefill', 'walltime', 'efficiency']) {
    const keys = rankGroups(groups, by, { promptTokens: 100, outputTokens: 100 }, 10).map(r => r.hardwareKey);
    assert.deepEqual(keys, ['aaa-rig', 'zzz-rig'], `by=${by}`);
  }
});

test('confidence ties (identical integer scores) sort by hardware|model (#793)', () => {
  const groups = [group('zzz-rig', 100, { score: 80 }), group('aaa-rig', 90, { score: 80 })];
  const keys = rankGroups(groups, 'confidence', null, 10).map(r => r.hardwareKey);
  assert.deepEqual(keys, ['aaa-rig', 'zzz-rig']);
});
