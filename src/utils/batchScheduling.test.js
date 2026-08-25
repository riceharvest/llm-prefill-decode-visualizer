import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRequests, simulateBatching, simulateStaticBatching, resolveChunkStopIndex, CHUNK_STOPS, DEFAULT_CHUNK_STOP_INDEX } from './batchScheduling.js';

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

test('different seeds draw different workloads (#692)', () => {
  // The seed was previously an unreachable parameter — the UI could never
  // re-roll the ±40% jitter. Pin that seeds actually select distinct draws.
  const seen = new Set();
  for (const seed of [1, 2, 3, 42, 99, 12345]) {
    const reqs = workload({ seed });
    const fingerprint = JSON.stringify(reqs.map(r => [r.promptTokens, r.outputTokens, r.arrivalTime]));
    seen.add(fingerprint);
  }
  assert.equal(seen.size, 6, 'each seed should yield its own workload');
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

// --- #572: large in-range workloads must not blow the call stack ---
test('summarize survives ~200k ITL samples without a RangeError (issue #572)', () => {
  // breqs=48 × bgen≈3072–4096 (all within their sliders' maxima) used to
  // crash Math.max(...itls) with "Maximum call stack size exceeded".
  const reqs = generateRequests({
    numRequests: 48,
    meanPromptTokens: 2000,
    meanOutputTokens: 4096,
    arrivalIntervalMs: 150,
    seed: 42
  });
  const sim = simulateBatching({ requests: reqs, maxBatchSize: 32, chunkSize: 512, ...PARAMS });
  const itlSamples = sim.requests.reduce((acc, r) => acc + r.itls.length, 0);
  assert.ok(itlSamples > 100000, `expected >100k ITL samples to exercise the old spread, got ${itlSamples}`);
  assert.ok(Number.isFinite(sim.summary.maxITL), 'maxITL is finite');
  assert.ok(Number.isFinite(sim.summary.avgITL));
  assert.ok(sim.summary.maxITL >= sim.summary.avgITL);
});

// --- #574: silent MAX_STEPS truncation must be machine-readable ---
test('step-cap truncation is flagged in summary instead of passing as final (#574)', () => {
  const reqs = generateRequests({
    numRequests: 48,
    meanPromptTokens: 2000,
    meanOutputTokens: 4096,
    arrivalIntervalMs: 150,
    seed: 42
  });
  // bmax=1 needs far more than the 20k-step safety cap.
  const sim = simulateBatching({ requests: reqs, maxBatchSize: 1, chunkSize: 512, ...PARAMS });
  assert.equal(sim.summary.truncated, true, 'summary.truncated set when the cap hits');
  assert.ok(sim.summary.unfinishedRequests > 0, 'unfinished count reported');
  assert.ok(sim.summary.stepsUsed <= sim.summary.maxSteps, 'stepsUsed vs cap exposed');
  const finished = sim.requests.filter(r => r.finishTime !== null).length;
  assert.equal(sim.summary.unfinishedRequests, reqs.length - finished);
  // Unserved requests carry null queueWait rather than fake numbers.
  for (const r of sim.requests) {
    if (r.finishTime === null && r.firstTokenTime === null && r.itls.length === 0) {
      // may or may not have started prefill; just ensure type sanity
      assert.ok(r.queueWait === null || Number.isFinite(r.queueWait));
    }
  }
});

test('runs that finish normally are NOT marked truncated (#574)', () => {
  const sim = simulateBatching({ requests: workload(), maxBatchSize: 8, chunkSize: 512, ...PARAMS });
  assert.equal(sim.summary.truncated, false);
  assert.equal(sim.summary.unfinishedRequests, 0);
  assert.equal(sim.summary.unfinishedRequests, sim.requests.filter(r => r.finishTime === null).length);
});

// --- #576: queue wait exists as data ---
test('queue-wait metrics are aggregated and per-request values are sane (#576)', () => {
  const reqs = generateRequests({
    numRequests: 24,
    meanPromptTokens: 4000,
    meanOutputTokens: 256,
    arrivalIntervalMs: 0, // all arrive at once → real queueing pressure
    seed: 11
  });
  const sim = simulateBatching({ requests: reqs, maxBatchSize: 2, chunkSize: 512, ...PARAMS });
  const { avgQueueWait, maxQueueWait } = sim.summary;
  assert.ok(Number.isFinite(avgQueueWait) && avgQueueWait > 0, 'avg queue wait positive');
  assert.ok(maxQueueWait >= avgQueueWait - 1e-12, 'max ≥ avg');
  let checked = 0;
  for (const r of sim.requests) {
    if (r.queueWait !== null) {
      checked++;
      assert.ok(r.queueWait >= 0, 'queue wait non-negative');
      if (Number.isFinite(r.ttft)) {
        // Queue wait ends when prefill starts; TTFT additionally covers prefill.
        assert.ok(r.ttft >= r.queueWait - 1e-9, `req ${r.id}: ttft ${r.ttft} ≥ queueWait ${r.queueWait}`);
      }
    }
  }
  assert.ok(checked > 0, 'at least one served request carries queueWait');
});

// --- #580: invalid ?bchunk= falls back to the DEFAULT stop, not index 5 ---
test('resolveChunkStopIndex maps invalid values to the 512 default (#580)', () => {
  assert.equal(DEFAULT_CHUNK_STOP_INDEX, CHUNK_STOPS.indexOf(512));
  // Valid stops pass through.
  for (let i = 0; i < CHUNK_STOPS.length; i++) {
    assert.equal(resolveChunkStopIndex(CHUNK_STOPS[i]), i);
  }
  // No param / valid default.
  assert.equal(resolveChunkStopIndex(512), CHUNK_STOPS.indexOf(512));
  // Garbage previously landed on stop index 5 (=2048); it must now match
  // exactly what an omitted param produces.
  for (const bad of [999, 300, 1e9, NaN, 'abc', undefined, null, -5]) {
    assert.equal(resolveChunkStopIndex(bad), CHUNK_STOPS.indexOf(512),
      `invalid bchunk=${bad} resolves to the same stop as no param`);
  }
});

