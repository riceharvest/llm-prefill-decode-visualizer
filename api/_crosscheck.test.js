import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confidence, crossCheck } from './_crosscheck.js';

const NOW = Date.parse('2026-08-21T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function run(decode, extra = {}) {
  return {
    modelFamily: 'llama',
    quantization: 'q4_k_m',
    decodeTokPerSec: decode,
    prefillTokPerSec: extra.prefill ?? 1000,
    gpuCount: extra.gpuCount ?? 1,
    gpu: extra.gpu ?? 'RTX 3090',
    hardware: extra.gpu ?? 'RTX 3090',
    createdAt: extra.createdAt ?? null
  };
}

// ---------- confidence ----------

test('confidence: a single submission grades low', () => {
  const c = confidence([run(120)], NOW);
  assert.equal(c.runs, 1);
  assert.equal(c.grade, 'low');
  assert.equal(c.outliers, 0);
});

test('confidence: 10+ tight runs grade high', () => {
  const runs = Array.from({ length: 12 }, (_, i) => run(120 + i));
  const c = confidence(runs, NOW);
  assert.equal(c.grade, 'high');
  assert.ok(c.iqrSpreadPct <= 40, `spread ${c.iqrSpreadPct}`);
});

test('confidence: several wide runs grade medium', () => {
  // 6 runs with a huge spread → not low (>=3), not high (>40% IQR)
  const runs = [run(50), run(60), run(80), run(150), run(300), run(500)];
  const c = confidence(runs, NOW);
  assert.equal(c.grade, 'medium');
  assert.ok(c.iqrSpreadPct > 40, `spread ${c.iqrSpreadPct}`);
});

test('confidence: counts outliers beyond the 1.5×IQR fences', () => {
  const runs = [run(100), run(101), run(102), run(103), run(104), run(500)];
  const c = confidence(runs, NOW);
  assert.equal(c.outliers, 1);
});

test('confidence: newestRunAgeDays reflects the newest createdAt', () => {
  const runs = [
    run(100, { createdAt: new Date(NOW - 10 * DAY).toISOString() }),
    run(110, { createdAt: new Date(NOW - 2 * DAY).toISOString() })
  ];
  const c = confidence(runs, NOW);
  assert.equal(c.newestRunAgeDays, 2);
});

test('confidence: no timestamps or empty groups stay null-safe', () => {
  const noTime = confidence([run(100)], NOW);
  assert.equal(noTime.newestRunAgeDays, null);
  const empty = confidence([], NOW);
  assert.equal(empty.runs, 0);
  assert.equal(empty.grade, 'low');
  assert.equal(empty.iqrSpreadPct, null);
});

// ---------- crossCheck ----------

test('crossCheck: healthy multi-GPU scaling raises no contradiction', () => {
  const runs = [
    run(130), run(128),
    run(250, { gpuCount: 2, gpu: '2x RTX 3090' })
  ];
  const cc = crossCheck(runs);
  assert.equal(cc.relatedRigComparisons, 1);
  assert.deepEqual(cc.contradictions, []);
});

test('crossCheck: multi-GPU rig slower than single card is flagged', () => {
  const runs = [
    run(130),
    run(100, { gpuCount: 2, gpu: '2x RTX 3090' })
  ];
  const cc = crossCheck(runs);
  assert.equal(cc.contradictions.length, 1);
  const c = cc.contradictions[0];
  assert.equal(c.kind, 'slower_than_single');
  assert.equal(c.metric, 'decode');
  assert.ok(c.deltaPct < 0, `delta ${c.deltaPct}`);
  assert.equal(c.gpuCount, 2);
});

test('crossCheck: sub-50% per-GPU scaling is flagged as poor_scaling', () => {
  // 4 cards but total only 180 vs 130 single → 34.6% per GPU
  const runs = [
    run(130),
    run(180, { gpuCount: 4, gpu: '4x RTX 3090' })
  ];
  const cc = crossCheck(runs);
  const c = cc.contradictions.find(x => x.kind === 'poor_scaling');
  assert.ok(c, 'expected poor_scaling contradiction');
  assert.ok(c.perGpuScalingPct < 50 && c.perGpuScalingPct > 30, `${c.perGpuScalingPct}`);
  assert.ok(c.deltaPct > 0); // total is faster, scaling is just bad
});

test('crossCheck: different quant or model family is never compared', () => {
  const runs = [
    run(130),
    { ...run(90, { gpuCount: 8 }), quantization: 'fp16' },
    { ...run(90, { gpuCount: 8 }), modelFamily: 'qwen' }
  ];
  const cc = crossCheck(runs);
  assert.equal(cc.relatedRigComparisons, 0);
  assert.deepEqual(cc.contradictions, []);
});

test('crossCheck: slower multi-GPU prefill is flagged too', () => {
  const runs = [
    { ...run(130), prefillTokPerSec: 9000 },
    { ...run(200, { gpuCount: 4 }), prefillTokPerSec: 4000 }
  ];
  const cc = crossCheck(runs);
  const prefillFlags = cc.contradictions.filter(c => c.metric === 'prefill');
  assert.equal(prefillFlags.length, 1);
  assert.equal(prefillFlags[0].kind, 'slower_than_single');
});

test('crossCheck: group without single-GPU baseline reports nothing', () => {
  const cc = crossCheck([
    run(250, { gpuCount: 2 }),
    run(240, { gpuCount: 2 })
  ]);
  assert.equal(cc.relatedRigComparisons, 0);
  assert.deepEqual(cc.contradictions, []);
});

// ---------- #967: machine-actionable comparison provenance ----------

test('#967: contradictions carry the runIds behind both medians', () => {
  const runs = [
    { ...run(130), runId: 's1' },
    { ...run(200, { gpuCount: 4 }), runId: 'm1' },
    { ...run(210, { gpuCount: 4 }), runId: 'm2' }
  ];
  const cc = crossCheck(runs);
  assert.equal(cc.relatedRigComparisons, 1); // still an integer (back-compat)
  const c = cc.contradictions.find(x => x.metric === 'decode');
  assert.ok(c, 'expected a decode contradiction');
  assert.deepEqual(c.baselineRunIds, ['s1']);
  assert.deepEqual(c.multiGpuRunIds, ['m1', 'm2']);
});

test('#967: comparisons[] exposes passing comparisons with flagged:false (#967)', () => {
  const runs = [
    { ...run(130), id: 's1' }, // healthy scaling — no contradiction
    { ...run(250, { gpuCount: 2 }), id: 'm1' }
  ];
  const cc = crossCheck(runs);
  assert.equal(cc.relatedRigComparisons, 1);
  assert.equal(cc.contradictions.length, 0);
  assert.equal(cc.comparisons.length, 1);
  const cmp = cc.comparisons[0];
  assert.equal(cmp.vs, '2x RTX 3090');
  assert.equal(cmp.gpuCount, 2);
  assert.deepEqual(cmp.baselineRunIds, ['s1']);
  assert.deepEqual(cmp.multiGpuRunIds, ['m1']);
  assert.equal(cmp.flagged, false);
});

test('#967: comparisons[].flagged is true exactly when a contradiction was emitted', () => {
  const runs = [
    { ...run(130), runId: 's1' },
    { ...run(90, { gpuCount: 4 }), runId: 'm1' } // slower than single → flagged
  ];
  const cc = crossCheck(runs);
  assert.equal(cc.comparisons.length, 1);
  assert.equal(cc.comparisons[0].flagged, true);
  assert.ok(cc.contradictions.length > 0);
});

test('#967: runs without any id field yield empty (not null) id arrays', () => {
  const cc = crossCheck([run(130), run(90, { gpuCount: 4 })]);
  assert.deepEqual(cc.comparisons[0].baselineRunIds, []);
  assert.deepEqual(cc.comparisons[0].multiGpuRunIds, []);
  for (const c of cc.contradictions) {
    assert.deepEqual(c.baselineRunIds, []);
    assert.deepEqual(c.multiGpuRunIds, []);
  }
});
