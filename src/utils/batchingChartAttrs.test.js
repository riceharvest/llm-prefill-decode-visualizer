// #715 — raw-numeric data attributes for the four batching charts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  requestRowAttrs,
  queueWaitAttrs,
  segmentAttrs,
  occupancyBarAttrs,
  itlBarAttrs
} from './batchingChartAttrs.js';

test('request rows expose arrival/TTFT/finish/token counts as data attributes', () => {
  const attrs = requestRowAttrs({
    id: 3, arrivalTime: 120, ttft: 310.5, finishTime: 900.25,
    promptTokens: 1024, outputTokens: 256
  });
  assert.deepEqual(attrs, {
    'data-request-id': '3',
    'data-arrival-ms': '120',
    'data-ttft-ms': '310.5',
    'data-finish-ms': '900.25',
    'data-prompt-tokens': '1024',
    'data-output-tokens': '256'
  });
});

test('non-finite timings render as empty strings, never "NaN"/"undefined"', () => {
  const attrs = requestRowAttrs({ id: 1, arrivalTime: NaN, ttft: null, finishTime: Infinity, promptTokens: 10, outputTokens: 5 });
  assert.equal(attrs['data-arrival-ms'], '');
  assert.equal(attrs['data-ttft-ms'], '');
  assert.equal(attrs['data-finish-ms'], '');
  assert.ok(!JSON.stringify(attrs).includes('NaN'));
  assert.ok(!JSON.stringify(attrs).includes('undefined'));
});

test('queue-wait gutter carries the exact wait in ms', () => {
  assert.deepEqual(queueWaitAttrs(87.5), { 'data-seg-kind': 'queue', 'data-queue-wait-ms': '87.5' });
});

test('prefill segments carry start/end plus chunk token count', () => {
  const attrs = segmentAttrs({ kind: 'prefill', tStart: 100, tEnd: 150, tokens: 512 });
  assert.equal(attrs['data-seg-kind'], 'prefill');
  assert.equal(attrs['data-start-ms'], '100');
  assert.equal(attrs['data-end-ms'], '150');
  assert.equal(attrs['data-tokens'], '512');
});

test('decode segments carry start/end and no token count', () => {
  const attrs = segmentAttrs({ kind: 'decode', tStart: 150, tEnd: 400 });
  assert.equal(attrs['data-seg-kind'], 'decode');
  assert.equal(attrs['data-start-ms'], '150');
  assert.equal(attrs['data-end-ms'], '400');
  assert.ok(!('data-tokens' in attrs));
});

test('occupancy bars expose step index, sequence count and capacity', () => {
  assert.deepEqual(occupancyBarAttrs(4.25, 6, 8), {
    'data-step': '7',
    'data-seqs': '4.3',
    'data-batch-capacity': '8'
  });
});

test('ITL bars expose step index, latency, and spike marker only on spikes', () => {
  assert.deepEqual(itlBarAttrs(12.4, 0, false), { 'data-step': '1', 'data-itl-ms': '12.4' });
  assert.deepEqual(itlBarAttrs(40, 2, true), { 'data-step': '3', 'data-itl-ms': '40', 'data-spike': 'true' });
});
