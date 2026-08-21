import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeRng,
  drawItlSamples,
  percentileSorted,
  summarizeItl,
  histogramItl,
  cumulativeItlSchedule,
  tokensEmittedBy
} from './itl.js';

test('makeRng is deterministic for a given seed', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const c = makeRng(7);
  for (let i = 0; i < 10; i++) {
    assert.equal(a(), b());
  }
  assert.notEqual(makeRng(42)(), makeRng(43)());
  assert.ok(c() >= 0 && c() < 1);
});

test('drawItlSamples is reproducible per seed and respects count', () => {
  const s1 = drawItlSamples({ baseMs: 20, cv: 0.3, count: 100, seed: 5 });
  const s2 = drawItlSamples({ baseMs: 20, cv: 0.3, count: 100, seed: 5 });
  const s3 = drawItlSamples({ baseMs: 20, cv: 0.3, count: 100, seed: 6 });
  assert.equal(s1.length, 100);
  assert.deepEqual(s1, s2);
  assert.notDeepEqual(s1, s3);
});

test('drawItlSamples edge cases: zero count, zero jitter, invalid input', () => {
  assert.deepEqual(drawItlSamples({ baseMs: 20, cv: 0.3, count: 0 }), []);
  assert.deepEqual(drawItlSamples({ baseMs: 20, cv: 0.3, count: -3 }), []);
  // cv = 0 ⇒ every draw is exactly base.
  assert.deepEqual(drawItlSamples({ baseMs: 20, cv: 0, count: 5, seed: 1 }), [20, 20, 20, 20, 20]);
  // Non-finite base collapses to 0 ms draws rather than NaNs.
  assert.deepEqual(drawItlSamples({ baseMs: NaN, cv: 0.5, count: 3 }), [0, 0, 0]);
});

test('lognormal mean correction keeps the sample mean at base', () => {
  const n = 20000;
  const base = 25;
  const cv = 0.5;
  const samples = drawItlSamples({ baseMs: base, cv, count: n, seed: 123 });
  const { mean } = summarizeItl(samples);
  // Sampling error on 20k draws is far below 1%.
  assert.ok(Math.abs(mean - base) / base < 0.01, `mean ${mean} vs base ${base}`);
});

test('percentileSorted matches known order statistics', () => {
  assert.ok(Number.isNaN(percentileSorted([], 50)));
  assert.equal(percentileSorted([7], 99), 7);
  assert.equal(percentileSorted([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentileSorted([1, 2, 3, 4], 0), 1);
  assert.equal(percentileSorted([1, 2, 3, 4], 100), 4);
  assert.equal(percentileSorted([10, 20, 30], 50), 20);
  // p50 of [1..100] is 50.5; p99 is 99.01 with linear interpolation.
  const asc = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.ok(Math.abs(percentileSorted(asc, 50) - 50.5) < 1e-12);
  assert.ok(Math.abs(percentileSorted(asc, 99) - 99.01) < 1e-12);
});

test('summarizeItl reports percentiles in order with extremes', () => {
  const { p50, p95, p99, min, max, count, mean } = summarizeItl([5, 1, 9, 3, 7]);
  assert.equal(count, 5);
  assert.equal(min, 1);
  assert.equal(max, 9);
  assert.equal(mean, 5);
  assert.equal(p50, 5);
  assert.ok(p50 < p95 && p95 < p99 && p99 <= max + 1e-12);
  const empty = summarizeItl([]);
  assert.ok(Number.isNaN(empty.p50) && empty.count === 0);
});

test('higher jitter fattens the right tail (p99/mean grows)', () => {
  const ratio = cv => {
    const s = summarizeItl(drawItlSamples({ baseMs: 20, cv, count: 20000, seed: 99 }));
    return s.p99 / s.mean;
  };
  const low = ratio(0.1);
  const high = ratio(0.6);
  assert.ok(high > low * 2, `p99/mean low=${low.toFixed(2)} high=${high.toFixed(2)}`);
  // p50 sits below the mean under lognormal skew.
  const s = summarizeItl(drawItlSamples({ baseMs: 20, cv: 0.5, count: 20000, seed: 99 }));
  assert.ok(s.p50 < s.mean);
});

test('histogramItl bins all samples with a closed right edge', () => {
  const samples = drawItlSamples({ baseMs: 20, cv: 0.4, count: 5000, seed: 3 });
  const { bins, min, max } = histogramItl(samples, 25);
  assert.equal(bins.length, 25);
  assert.ok(Math.abs(bins[0].from - min) < 1e-9);
  assert.ok(Math.abs(bins[bins.length - 1].to - max) < 1e-9);
  const total = bins.reduce((acc, b) => acc + b.count, 0);
  assert.equal(total, samples.length);
  // Bins are contiguous and ordered.
  for (let i = 1; i < bins.length; i++) {
    assert.ok(Math.abs(bins[i].from - bins[i - 1].to) < 1e-9);
    assert.ok(bins[i].from <= bins[i].to);
  }
  // Degenerate single-value input collapses to one full bin.
  const one = histogramItl([5, 5, 5], 10);
  assert.equal(one.bins.length, 1);
  assert.equal(one.bins[0].count, 3);
  assert.deepEqual(histogramItl([], 10).bins, []);
});

test('cumulative schedule is strictly increasing and emission search is exact', () => {
  const samples = drawItlSamples({ baseMs: 20, cv: 0.3, count: 200, seed: 11 });
  const schedule = cumulativeItlSchedule(samples);
  assert.equal(schedule.length, samples.length);
  for (let i = 1; i < schedule.length; i++) {
    assert.ok(schedule[i] > schedule[i - 1]);
    assert.ok(Math.abs(schedule[i] - schedule[i - 1] - samples[i]) < 1e-9);
  }
  assert.equal(tokensEmittedBy(schedule, -1), 0);
  assert.equal(tokensEmittedBy(schedule, 0), 0);
  assert.equal(tokensEmittedBy(schedule, schedule[4]), 5);
  assert.equal(tokensEmittedBy(schedule, schedule[4] + 1e-6), 5);
  assert.equal(tokensEmittedBy(schedule, schedule[schedule.length - 1] + 1), schedule.length);
  assert.equal(tokensEmittedBy([], 100), 0);
});
