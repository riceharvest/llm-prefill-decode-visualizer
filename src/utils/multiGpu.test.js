import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseParamBillions,
  planSplit,
  GPU_CARDS,
  DECODE_PENALTY_PCT
} from './multiGpu.js';

test('parseParamBillions handles B and T labels', () => {
  assert.equal(parseParamBillions('70B'), 70);
  assert.equal(parseParamBillions('2.8T'), 2800);
  assert.equal(parseParamBillions('2.6B'), 2.6);
  assert.equal(parseParamBillions('754B'), 754);
  assert.equal(parseParamBillions('garbage'), null);
  assert.equal(parseParamBillions(''), null);
});

// 70B @ INT4 (0.5 B/param) = 35 GB weights; KV 10 GiB total.
function args(overrides = {}) {
  return {
    paramB: 70,
    weightBytesPerParam: 0.5,
    totalKvBytes: 10 * 1024 ** 3,
    kvHeads: 8,
    kvLayers: 80,
    gpuCount: 2,
    mode: 'tp',
    interconnect: 'pcie',
    cardVramGb: 24,
    ...overrides
  };
}

test('weights and sharded KV split evenly across GPUs', () => {
  const plan = planSplit(args());
  // 70B × 0.5 bytes = 35e9 bytes total → half per GPU, in GiB
  assert.ok(Math.abs(plan.weightsPerGpuGb - 35e9 / 2 / 1024 ** 3) < 1e-9);
  // KV heads (8) divide by 2 → sharded, 5 GiB per GPU
  assert.equal(plan.kvSharded, true);
  assert.ok(Math.abs(plan.kvPerGpuGb - 5) < 1e-9);
});

test('TP replicates KV when there are too few KV heads to divide', () => {
  const plan = planSplit(args({ gpuCount: 4, kvHeads: 2 }));
  assert.equal(plan.kvSharded, false);
  assert.ok(Math.abs(plan.kvPerGpuGb - 10) < 1e-6);
  assert.ok(plan.warnings.includes('kvReplicated'));
});

test('PP shards KV by layer even with few heads', () => {
  const plan = planSplit(args({ mode: 'pp', kvHeads: 2 }));
  assert.equal(plan.kvSharded, true);
  assert.ok(Math.abs(plan.kvPerGpuGb - 5) < 1e-9);
  assert.ok(!plan.warnings.includes('kvReplicated'));
});

test('PCIe TP costs ~10% decode, NVLink ~3%, PP flat regardless of bus', () => {
  assert.equal(planSplit(args()).decodePenaltyPct, DECODE_PENALTY_PCT.tp.pcie);
  assert.equal(planSplit(args({ interconnect: 'nvlink' })).decodePenaltyPct, DECODE_PENALTY_PCT.tp.nvlink);
  assert.equal(planSplit(args({ mode: 'pp' })).decodePenaltyPct, DECODE_PENALTY_PCT.pp.pcie);
  assert.equal(
    planSplit(args({ mode: 'pp', interconnect: 'nvlink' })).decodePenaltyPct,
    DECODE_PENALTY_PCT.pp.nvlink
  );
});

test('fit verdict: 70B Q4 + 12 GiB KV on 2×24 GB PCIe does not fit, 2×48 GB does', () => {
  const plan = planSplit(args({ totalKvBytes: 12 * 1024 ** 3 }));
  // per GPU: ~16.3 GiB weights + 6 GiB KV + 1.5 overhead > 22.8 usable on a 24 GB card
  assert.equal(plan.fits, false);
  assert.ok(plan.warnings.includes('doesNotFit'));

  const roomier = planSplit(args({ totalKvBytes: 12 * 1024 ** 3, cardVramGb: 48 }));
  assert.equal(roomier.fits, true);
  assert.ok(roomier.headroomGb > 0);
  assert.ok(!roomier.warnings.includes('doesNotFit'));
});

test('warns that one bigger single card beats 2 small cards over PCIe TP', () => {
  // 8B model at FP16 = 16 GB + 2 GiB KV fits a single 24 GB card — so two
  // 12-ish-class cards over PCIe are pointless next to one 24 GB card.
  const plan = planSplit(args({
    paramB: 8,
    weightBytesPerParam: 2,
    totalKvBytes: 2 * 1024 ** 3,
    cardVramGb: 24
  }));
  assert.ok(plan.largerCard, 'expected a larger-card suggestion');
  assert.ok(plan.warnings.includes('singleCardFaster'));
});

test('no larger-card warning on NVLink or pipeline parallelism', () => {
  for (const overrides of [{ interconnect: 'nvlink' }, { mode: 'pp' }]) {
    const plan = planSplit(args({
      paramB: 8,
      weightBytesPerParam: 2,
      totalKvBytes: 2 * 1024 ** 3,
      ...overrides
    }));
    assert.ok(!plan.warnings.includes('singleCardFaster'), JSON.stringify(overrides));
  }
});

test('single GPU has no interconnect penalty and no split warnings', () => {
  const plan = planSplit(args({
    gpuCount: 1,
    paramB: 8,
    weightBytesPerParam: 2,
    totalKvBytes: 2 * 1024 ** 3
  }));
  assert.equal(plan.decodePenaltyPct, 0);
  assert.equal(plan.effectiveDecodeFactor, 1);
  assert.deepEqual(plan.warnings, []);
});

test('card catalog is ordered by VRAM ascending (first-fit suggestion logic)', () => {
  const sizes = GPU_CARDS.map(c => c.vramGb);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
});

// Issue #499: a missing/non-finite totalKvBytes used to poison every plan
// metric into NaN — the UI rendered literal '—' and "over by —" in every mode.
test('#499: non-finite totalKvBytes degrades to a weights-only finite plan', () => {
  for (const bad of [undefined, NaN, null, Infinity, 'not-a-number']) {
    const plan = planSplit({
      paramB: 70,
      weightBytesPerParam: 0.5,
      totalKvBytes: bad,
      kvHeads: 8,
      gpuCount: 2,
      mode: 'tp',
      interconnect: 'pcie',
      cardVramGb: 24
    });
    assert.equal(plan.kvPerGpuGb, 0, `kvPerGpuGb must be 0 for ${bad}`);
    assert.ok(Number.isFinite(plan.perGpuNeededGb));
    assert.ok(Number.isFinite(plan.headroomGb));
    assert.equal(typeof plan.fits, 'boolean');
    // Weights still computed correctly: 70B × 0.5 B ÷ 2 GPUs in GiB.
    assert.ok(Math.abs(plan.weightsPerGpuGb - (70e9 * 0.5 / 2) / (1024 ** 3)) < 1e-6);
  }
});

test('#499: KVCacheCalculator passes its KV total under the prop name MultiGpuPlanner reads', async () => {
  const caller = await readFile(new URL('../components/KVCacheCalculator.jsx', import.meta.url), 'utf8');
  const planner = await readFile(new URL('../components/MultiGpuPlanner.jsx', import.meta.url), 'utf8');

  // The planner destructures { preset, totalKvBytes } — the caller must use
  // exactly that name (the old totalKVCacheBytes= spelling was silently
  // undefined, rendering '—' for every metric).
  assert.match(planner, /totalKvBytes/);
  assert.match(caller, /<MultiGpuPlanner[^>]*totalKvBytes=\{totalKVCacheBytes\}/s);
});
