import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseParamsB,
  weightsGiB,
  WEIGHT_PRECISIONS,
  GPU_CATALOG,
  gpuById
} from './vramPlanner.js';
import { vramBudget, DEFAULT_OVERHEAD_FRACTION } from '../../lib/_math.js';

test('parseParamsB: B/T/bare tags', () => {
  assert.equal(parseParamsB('70B'), 70);
  assert.equal(parseParamsB('2.8T'), 2800);
  assert.equal(parseParamsB('27B'), 27);
  assert.equal(parseParamsB('754B'), 754);
  assert.equal(parseParamsB('8B'), 8);
});

test('parseParamsB: garbage returns null', () => {
  assert.equal(parseParamsB(''), null);
  assert.equal(parseParamsB(null), null);
  assert.equal(parseParamsB('unknown'), null);
  assert.equal(parseParamsB('-5B'), null);
});

test('weightsGiB: 70B @ FP16 ≈ 130.4 GiB, @ Q4 ≈ 36.7 GiB', () => {
  assert.ok(Math.abs(weightsGiB(70, 16) - 130.39) < 0.05);
  assert.ok(Math.abs(weightsGiB(70, 4.5) - 36.67) < 0.05);
  assert.equal(weightsGiB(null, 16), null);
});

test('catalog: ids unique, VRAM positive, every weight precision has bpw', () => {
  const ids = new Set(GPU_CATALOG.map(g => g.id));
  assert.equal(ids.size, GPU_CATALOG.length);
  for (const g of GPU_CATALOG) assert.ok(g.vramGb > 0 && g.name);
  for (const p of WEIGHT_PRECISIONS) assert.ok(p.bpw > 0 && p.label);
  assert.equal(gpuById('nope'), null);
  assert.equal(gpuById('rtx4090').vramGb, 24);
});

test('vramBudget: 70B Q4 + 32k FP16 KV fits an 80 GB card with default overhead', () => {
  // LLaMA-3.3 70B GQA KV @32k FP16: 2*80*8*128*2 B/tok * 32768 = 10.74 GB
  const kvGb = (2 * 80 * 8 * 128 * 2 * 32768) / (1024 ** 3);
  const r = vramBudget({
    weightsGb: weightsGiB(70, 4.5),
    kvGb,
    overheadFraction: DEFAULT_OVERHEAD_FRACTION,
    gpuVramGb: 80
  });
  assert.equal(r.verdict, 'pass');
  assert.ok(r.fits);
  assert.ok(r.headroomGb > 0);
  assert.ok(r.utilizationPct < 90);
  // overhead = (weights+kv)*0.15
  assert.ok(Math.abs(r.totalGb - (weightsGiB(70, 4.5) + kvGb) * 1.15) < 0.01);
});

test('vramBudget: same load fails on 24 GB and warns in the tight band', () => {
  const weightsGb = 20;
  const kvGb = 3; // total*1.15 = 26.45 → fail on 24
  const fail = vramBudget({ weightsGb, kvGb, gpuVramGb: 24 });
  assert.equal(fail.verdict, 'fail');
  assert.ok(!fail.fits);
  assert.ok(fail.headroomGb < 0);

  // Numbers landing between 90% and 100% of 24 GB: 17+2=19, ×1.15 = 21.85 → 91%
  const tight = vramBudget({ weightsGb: 17, kvGb: 2, gpuVramGb: 24 });
  assert.equal(tight.verdict, 'warn');
  assert.ok(tight.fits);
  assert.ok(tight.utilizationPct > 90 && tight.utilizationPct <= 100);

  // boundary: exactly at the warn threshold is still a pass
  const edge = vramBudget({ weightsGb: 18.7826, kvGb: 0, gpuVramGb: 24 });
  assert.equal(edge.verdict, 'pass');
});

test('vramBudget: no GPU → verdict null, headroom null, ledger still complete', () => {
  const r = vramBudget({ weightsGb: 10, kvGb: 2 });
  assert.equal(r.verdict, null);
  assert.equal(r.headroomGb, null);
  assert.equal(r.utilizationPct, null);
  assert.ok(r.totalGb > 12); // includes 15% overhead by default
});

test('vramBudget: never throws on garbage input', () => {
  const r = vramBudget({ weightsGb: 'x', kvGb: -5, overheadFraction: NaN, gpuVramGb: 0 });
  assert.equal(r.weightsGb, 0);
  assert.equal(r.kvGb, 0);
  assert.equal(r.verdict, null);
});
