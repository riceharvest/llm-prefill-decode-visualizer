import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainRecommendation } from './_explain.js';

const FIT_OK = { fits: true, estimatedWeightsGb: 15.6, estimatedKvCacheGb: 6, headroomGb: 2.1 };
const FIT_BAD = { fits: false, estimatedWeightsGb: 29.3, estimatedKvCacheGb: 6, headroomGb: -11.4 };

test('explainRecommendation: fitting option combines fit math + measured source (#73)', () => {
  const s = explainRecommendation({
    memoryGb: 24, paramsB: 27, quantization: 'q4_k_m', contextLength: 65536,
    fit: FIT_OK, decodeTokPerSec: 41.7, runId: 1234
  });
  assert.equal(
    s,
    '24GB fits 27B q4_k_m weights ~16GB + 64k KV ~6GB with 2GB headroom; measured 41.7 tok/s decode from run #1234'
  );
  // One sentence, pass-through ready.
  assert.ok(!s.includes('\n'));
});

test('explainRecommendation: non-fitting option states the shortfall', () => {
  const s = explainRecommendation({
    memoryGb: 24, paramsB: 27, quantization: 'q8_0', contextLength: 65536,
    fit: FIT_BAD, decodeTokPerSec: 42, runId: 1234
  });
  assert.equal(
    s,
    '24GB cannot fit 27B q8_0 weights ~29GB + 64k KV ~6GB (short 12GB); measured 42 tok/s decode from run #1234'
  );
});

test('explainRecommendation: without fit math it still names rig size vs model', () => {
  const s = explainRecommendation({
    memoryGb: 24, paramsB: 8, quantization: 'q4_k_m', contextLength: 32768,
    fit: null, decodeTokPerSec: 100, runId: 'a1'
  });
  assert.equal(s, '8B q4_k_m on 24GB; measured 100 tok/s decode from run #a1');
});

test('explainRecommendation: no runId falls back to the group-median phrasing', () => {
  const s = explainRecommendation({
    memoryGb: 48, paramsB: 8, quantization: 'q4_k_m', contextLength: 32768,
    fit: FIT_OK, decodeTokPerSec: 85.44, runsInGroup: 3
  });
  assert.equal(s.endsWith('median 85.4 tok/s decode across 3 runs'), true);
});

test('explainRecommendation: unassessable memory keeps the measured clause only', () => {
  const s = explainRecommendation({
    memoryGb: null, paramsB: 8, quantization: 'q4_k_m',
    fit: null, decodeTokPerSec: 42, runId: 9
  });
  assert.equal(s, 'measured 42 tok/s decode from run #9');
});

test('explainRecommendation: nothing measurable → null, callers render null', () => {
  assert.equal(explainRecommendation({}), null);
  assert.equal(explainRecommendation({ memoryGb: null, paramsB: null, decodeTokPerSec: NaN }), null);
});

test('explainRecommendation: sub-1k context renders without the k suffix', () => {
  const s = explainRecommendation({
    memoryGb: 8, paramsB: 3, quantization: 'q4_k_m', contextLength: 512,
    fit: { fits: true, estimatedWeightsGb: 1.7, estimatedKvCacheGb: 0.1, headroomGb: 6.1 },
    decodeTokPerSec: 30, runId: 7
  });
  assert.equal(
    s,
    '8GB fits 3B q4_k_m weights ~2GB + 512 KV ~<1GB with 6GB headroom; measured 30 tok/s decode from run #7'
  );
});
