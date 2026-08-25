import test from 'node:test';
import assert from 'node:assert/strict';

// Issue #398: the batching view must produce a machine-readable artifact.
// Builders are pure — same inputs, byte-identical output.

import { buildBatchingMarkdown, buildBatchingJson } from './exportBatching.js';

const ARGS = {
  numRequests: 12,
  meanPromptTokens: 2000,
  meanOutputTokens: 256,
  maxBatchSize: 8,
  chunkSize: 512,
  arrivalIntervalMs: 150,
  prefillSpeed: 3800.4,
  decodeSpeed: 105.2,
  summary: {
    makespan: 10.8843,
    totalOutputTokens: 2929,
    throughput: 269.16,
    avgTTFT: 0.61234,
    maxTTFT: 1.2345,
    avgITL: 0.00952,
    maxITL: 0.02,
    occupancyPct: 72.44,
    stalledStepPct: 31.25
  },
  staticSummary: { makespan: 14.2211, totalOutputTokens: 2929, throughput: 205 },
  requests: [
    { id: 0, promptTokens: 1984, outputTokens: 240, arrivalTime: 0, ttft: 0.522, finishTime: 2.8017 },
    { id: 1, promptTokens: 2112, outputTokens: 272, arrivalTime: 0.15, ttft: null, finishTime: null }
  ],
  deepLink: 'https://example.test/?tab=batching&breqs=12'
};

test('batching markdown contains config, metric table and per-request rows', () => {
  const md = buildBatchingMarkdown(ARGS);
  assert.match(md, /# Continuous batching simulation/);
  assert.match(md, /mean prompt tokens = 2000/);
  assert.match(md, /\| Makespan \| 10\.9s \|/);
  assert.match(md, /\| Batch occupancy \| 72\.4% \|/);
  assert.match(md, /Continuous saving: 3\.3s \(23\.5%\)/);
  assert.match(md, /\| 0 \| 1984 \| 240 \| 522 \| 2\.8 \|/);
  assert.match(md, /Reproduce: https:\/\/example\.test\/\?tab=batching&breqs=12/);
});

test('batching markdown is byte-identical for identical inputs', () => {
  assert.equal(buildBatchingMarkdown(ARGS), buildBatchingMarkdown(ARGS));
});

test('batching JSON exposes workload, results and comparison blocks', () => {
  const json = buildBatchingJson(ARGS);
  assert.equal(json.view, 'batching');
  assert.equal(json.workload.requests, 12);
  assert.equal(json.workload.chunkingEnabled, true);
  assert.equal(json.continuous.totalOutputTokens, 2929);
  assert.equal(json.staticBatching.makespan, 14.2211);
  assert.ok(Math.abs(json.comparison.savingSeconds - 3.3368) < 1e-9);
  assert.equal(json.requests[1].ttft, null);
  assert.equal(json.requests[1].finishTime, null);
});
