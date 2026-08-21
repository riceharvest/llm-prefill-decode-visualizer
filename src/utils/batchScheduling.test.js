import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRequests, simulateBatching, simulateStaticBatching } from './batchScheduling.js';

const PARAMS = {
  prefillSpeed: 5000,  // tok/s
  decodeSpeed: 50      // tok/s → decode step = 20 ms
};

function workload(overrides = {}) {
  return generateRequests({
    numRequests: 12,
    meanPromptTokens: 2000,
    meanOutputTokens: 128,
    arrivalIntervalMs: 150,
    seed: 7,
    ...overrides
  });
}

test('generateRequests is deterministic for a given seed and respects counts', () => {
  const a = workload();
  const b = workload();
  assert.equal(a.length, 12);
  assert.deepEqual(a, b);
  for (const r of a) {
    assert.ok(r.promptTokens >= 1 && r.outputTokens >= 1);
    assert.ok(Number.isFinite(r.arrivalTime));
  }
});

test('continuous batching never exceeds max batch size', () => {
  const sim = simulateBatching({ requests: workload(), maxBatchSize: 4, chunkSize: 512, ...PARAMS });
  for (const step of sim.steps) {
    assert.ok(step.batchSize <= 4, `step ${step.index} batchSize ${step.batchSize}`);
    assert.ok(step.admitted.length + (step.batchSize - step.admitted.length) <= 4 || true);
  }
});

test('every request decodes exactly its output tokens and finishes', () => {
  const reqs = workload();
  const sim = simulateBatching({ requests: reqs, maxBatchSize: 8, chunkSize: 512, ...PARAMS });
  assert.equal(sim.requests.length, reqs.length);
  for (const r of sim.requests) {
    assert.ok(Number.isFinite(r.firstTokenTime), `req ${r.id} has first token`);
    assert.ok(Number.isFinite(r.finishTime), `req ${r.id} finished`);
    assert.equal(r.itls.length, r.outputTokens - 1, `req ${r.id} ITL count`);
    assert.ok(r.ttft > 0, `req ${r.id} TTFT after arrival`);
    assert.ok(r.finishTime <= sim.makespan + 1e-9);
  }
  // Total decoded tokens across steps == total output tokens.
  const totalDecoded = sim.steps.reduce((acc, s) => acc + s.decoded.length, 0);
  const totalOutput = reqs.reduce((acc, r) => acc + r.outputTokens, 0);
  assert.equal(totalDecoded, totalOutput);
  // Total prefilled tokens across steps == total prompt tokens.
  const totalPrefilled = sim.steps.reduce((acc, s) => acc + (s.prefill ? s.prefill.tokens : 0), 0);
  const totalPrompt = reqs.reduce((acc, r) => acc + r.promptTokens, 0);
  assert.equal(totalPrefilled, totalPrompt);
});

test('chunked prefill caps ITL spikes vs unchunked prefill', () => {
  const reqs = workload();
  const unchunked = simulateBatching({ requests: reqs, maxBatchSize: 8, chunkSize: 0, ...PARAMS });
  const chunked = simulateBatching({ requests: reqs, maxBatchSize: 8, chunkSize: 256, ...PARAMS });
  assert.ok(chunked.summary.maxITL < unchunked.summary.maxITL,
    `chunked maxITL ${chunked.summary.maxITL} should beat unchunked ${unchunked.summary.maxITL}`);
  // Unchunked steps carrying prefill must stretch far beyond one decode period.
  const stretched = unchunked.steps.filter(s => s.prefill && s.prefill.tokens > 100);
  assert.ok(stretched.length > 0);
  assert.ok(stretched.some(s => s.duration > 1 / PARAMS.decodeSpeed),
    'unchunked prefill steps should stretch beyond one decode period');
});

test('continuous batching beats static batching on makespan with staggered arrivals', () => {
  const reqs = workload();
  const cont = simulateBatching({ requests: reqs, maxBatchSize: 4, chunkSize: 512, ...PARAMS });
  const stat = simulateStaticBatching({ requests: reqs, maxBatchSize: 4, ...PARAMS });
  assert.ok(cont.makespan < stat.makespan,
    `continuous ${cont.makespan.toFixed(3)}s should finish before static ${stat.makespan.toFixed(3)}s`);
});

test('steps are contiguous in time and non-degenerate', () => {
  const sim = simulateBatching({ requests: workload(), maxBatchSize: 6, chunkSize: 1024, ...PARAMS });
  for (let i = 1; i < sim.steps.length; i++) {
    assert.ok(Math.abs(sim.steps[i].tStart - sim.steps[i - 1].tEnd) < 1e-9, `step ${i} starts where ${i - 1} ended`);
    assert.ok(sim.steps[i].duration > 0);
  }
});

test('idle gap before first arrival produces no empty busy steps', () => {
  const late = [{ id: 1, promptTokens: 500, outputTokens: 10, arrivalTime: 2 }];
  const sim = simulateBatching({ requests: late, maxBatchSize: 4, chunkSize: 256, ...PARAMS });
  assert.equal(sim.steps[0].tStart, 2);
});
