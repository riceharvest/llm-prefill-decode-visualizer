import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ganttRowLabel,
  queueSegmentLabel,
  prefillSegmentLabel,
  decodeSegmentLabel,
  occupancyChartLabel,
  occupancyBarLabel,
  itlChartLabel,
  itlBarLabel
} from './batchingChartA11y.js';

const req = { id: 3, promptTokens: 1024, outputTokens: 512, ttft: 340.2 };

test('#785 Gantt row label carries identity + workload + TTFT as text', () => {
  const label = ganttRowLabel(req);
  assert.match(label, /R3/);
  assert.match(label, /1,024/);
  assert.match(label, /512/);
  assert.match(label, /TTFT 340 ms/);
});

test('#785 decode segment label carries the timing the old tooltip omitted', () => {
  const seg = { kind: 'decode', tStart: 400, tEnd: 6400 };
  const label = decodeSegmentLabel(req, seg);
  assert.match(label, /6,000 ms/); // duration now exposed
  assert.match(label, /per token/);
  assert.notEqual(label, ''); // and it is not the old "1 tok / step" non-value
});

test('#785 prefill and queue labels expose tokens/wait', () => {
  assert.match(prefillSegmentLabel({ kind: 'prefill', tStart: 120, tEnd: 460, tokens: 1024 }), /1,024 tokens in 340 ms/);
  assert.match(queueSegmentLabel(req, 120), /queued 120 ms/);
});

test('#785 occupancy summary exposes step count, average and peak', () => {
  const label = occupancyChartLabel([1, 2, 3]);
  assert.match(label, /3 steps/);
  assert.match(label, /average 2\.0/);
  assert.match(label, /peak 3\.0/);
  assert.equal(occupancyChartLabel([]), 'Batch occupancy per step: empty');
  assert.equal(occupancyBarLabel(2.5, 4), 'Step 5: 2.5 sequences in batch');
});

test('#785 ITL labels expose per-step values incl. spike flag', () => {
  const label = itlChartLabel([40, 42, 90]);
  assert.match(label, /3 decode steps/);
  assert.match(label, /worst 90 ms/);
  assert.equal(itlBarLabel(42, 0, false), 'Step 1: 42 ms between tokens');
  assert.match(itlBarLabel(90, 2, true), /prefill interleaved/);
});
