#!/usr/bin/env node
/**
 * Headless simulation driver for CI.
 *
 * Runs the visualizer's pure-JS simulation modules (batch scheduling, ITL
 * sampling, agentic timeline math, GPU split planning) end to end without a
 * browser or display, checks core invariants on the results, prints a JSON
 * summary, and exits non-zero if any invariant fails.
 *
 * Usage: node scripts/run-sim.mjs
 */
import assert from 'node:assert/strict';

import {
  generateRequests,
  simulateBatching,
  simulateStaticBatching
} from '../src/utils/batchScheduling.js';
import { drawItlSamples, summarizeItl } from '../src/utils/itl.js';
import { calculateAgenticTimeline } from '../src/utils/agenticMath.js';
import { planSplit } from '../src/utils/multiGpu.js';
import { decodeSpeedAtContext } from '../src/utils/contextScaling.js';

const scenarios = [];

function record(name, fn) {
  try {
    const detail = fn();
    scenarios.push({ name, ok: true, detail });
  } catch (err) {
    scenarios.push({ name, ok: false, error: err.message });
  }
}

const isFinitePositive = (x) => Number.isFinite(x) && x > 0;

// --- Continuous batching ---------------------------------------------------
record('continuous-batching', () => {
  const requests = generateRequests({
    numRequests: 24,
    meanPromptTokens: 1200,
    meanOutputTokens: 256,
    arrivalIntervalMs: 40,
    seed: 42
  });
  const run = simulateBatching({
    requests,
    maxBatchSize: 8,
    chunkSize: 512,
    prefillSpeed: 45_000,
    decodeSpeed: 90
  });

  assert.equal(run.requests.length, requests.length, 'every request appears in the timeline');
  for (const r of run.requests) {
    assert.ok(isFinitePositive(r.finishTime), `request ${r.id} finishTime must be finite/positive`);
    assert.ok(r.firstTokenTime === null || r.firstTokenTime >= r.arrivalTime - 1e-9,
      `request ${r.id} cannot decode before it arrives`);
    assert.ok(r.finishTime >= (r.firstTokenTime ?? 0) - 1e-9,
      `request ${r.id} finishes after its first token`);
  }
  assert.ok(isFinitePositive(run.makespan), 'makespan must be finite/positive');
  assert.ok(Object.keys(run.summary).length > 0, 'summary metrics are produced');
  return {
    makespanSec: Number(run.makespan.toFixed(3)),
    summary: run.summary
  };
});

// --- Static batching baseline ----------------------------------------------
record('static-batching', () => {
  const requests = generateRequests({
    numRequests: 16,
    meanPromptTokens: 800,
    meanOutputTokens: 128,
    arrivalIntervalMs: 0,
    seed: 7
  });
  const run = simulateStaticBatching({
    requests,
    maxBatchSize: 4,
    prefillSpeed: 30_000,
    decodeSpeed: 60
  });
  assert.equal(run.requests.length, requests.length);
  for (const r of run.requests) {
    assert.ok(isFinitePositive(r.finishTime), `request ${r.id} finishTime must be finite/positive`);
  }
  assert.ok(isFinitePositive(run.makespan));
  return { makespanSec: Number(run.makespan.toFixed(3)) };
});

// --- Inter-token latency statistics ----------------------------------------
record('itl-statistics', () => {
  const samples = drawItlSamples({ baseMs: 20, cv: 0.35, count: 5000, seed: 123 });
  const stats = summarizeItl(samples);
  assert.equal(stats.count, 5000);
  for (const key of ['mean', 'p50', 'p95', 'p99', 'min', 'max']) {
    assert.ok(isFinitePositive(stats[key]), `${key} must be finite/positive`);
  }
  assert.ok(stats.p50 <= stats.p95 && stats.p95 <= stats.p99, 'percentiles are monotonic');
  assert.ok(stats.min <= stats.mean && stats.mean <= stats.max, 'mean lies within [min, max]');
  // Lognormal with cv=0.35 has a known analytic mean of exactly baseMs.
  assert.ok(Math.abs(stats.mean - 20) < 0.5, `mean ~20ms, got ${stats.mean.toFixed(3)}`);
  return { meanMs: Number(stats.mean.toFixed(3)), p99Ms: Number(stats.p99.toFixed(3)) };
});

// --- Agentic multi-turn timeline -------------------------------------------
record('agentic-timeline', () => {
  const uncached = calculateAgenticTimeline({
    numTurns: 6,
    basePromptTokens: 2000,
    toolOutputTokensPerTurn: 800,
    decodeTokensPerTurn: 400,
    prefillSpeed: 50_000,
    decodeSpeed: 80,
    enablePrefixCaching: false
  });
  const cached = calculateAgenticTimeline({
    numTurns: 6,
    basePromptTokens: 2000,
    toolOutputTokensPerTurn: 800,
    decodeTokensPerTurn: 400,
    prefillSpeed: 50_000,
    decodeSpeed: 80,
    enablePrefixCaching: true
  });
  const last = (turns) => turns[turns.length - 1];
  for (const turn of cached) {
    assert.ok(turn.newTokensPrefilled <= turn.totalPromptTokens,
      'prefix caching never prefills more than the full context');
  }
  assert.ok(last(cached).cumulativeWalltime < last(uncached).cumulativeWalltime,
    'prefix caching reduces total walltime');
  return {
    walltimeUncachedSec: Number(last(uncached).cumulativeWalltime.toFixed(3)),
    walltimeCachedSec: Number(last(cached).cumulativeWalltime.toFixed(3))
  };
});

// --- Tensor-parallel split planning -----------------------------------------
record('gpu-split-plan', () => {
  const plan = planSplit({
    paramB: 70,
    weightBytesPerParam: 2,
    totalKvBytes: 8 * 1024 ** 3,
    kvHeads: 8,
    kvLayers: 80,
    gpuCount: 4,
    mode: 'tp',
    interconnect: 'pcie',
    cardVramGb: 24
  });
  assert.ok(plan, 'planSplit returns a plan');
  for (const value of Object.values(plan)) {
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value), `plan values must be finite (got ${value})`);
    }
  }
  // 70B params at 2 bytes = 140 GB ≈ 130.4 GiB total, so ~32.6 GiB per GPU.
  assert.ok(plan.weightsPerGpuGb > 30 && plan.weightsPerGpuGb < 36,
    `weights sharded evenly (got ${plan.weightsPerGpuGb.toFixed(2)} GiB/GPU)`);
  return {
    fits: plan.fits,
    weightsPerGpuGb: Number(plan.weightsPerGpuGb.toFixed(2)),
    headroomGb: Number(plan.headroomGb.toFixed(2)),
    warnings: plan.warnings
  };
});

// --- Context-scaled decode speed --------------------------------------------
record('context-scaling', () => {
  const short = decodeSpeedAtContext(100, 2048);
  const long = decodeSpeedAtContext(100, 131072);
  assert.ok(isFinitePositive(short) && isFinitePositive(long));
  assert.ok(long <= short, 'decode speed never increases with longer context');
  return { tokPerSecAt2k: Number(short.toFixed(2)), tokPerSecAt128k: Number(long.toFixed(2)) };
});

const failed = scenarios.filter((s) => !s.ok);
const report = {
  scenarios: scenarios.length,
  passed: scenarios.length - failed.length,
  failed: failed.length,
  results: scenarios
};
console.log(JSON.stringify(report, null, 2));

if (failed.length > 0) {
  console.error(`headless sim FAILED: ${failed.length}/${scenarios.length} scenario(s)`);
  process.exit(1);
}
console.log(`headless sim OK: ${scenarios.length}/${scenarios.length} scenarios passed`);
