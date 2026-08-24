import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishedCountAt, progressBucket } from './liveSummary.js';

// Issue #1041: the batching run summary must stay stable within a 25% time
// bucket — announced counters may only change at bucket boundaries, never on
// individual request start/finish events.

test('progressBucket: index and bucket-start time are stable across each quarter', () => {
  const total = 100;
  for (let b = 0; b < 4; b++) {
    const start = (b / 4) * total;
    const samples = [start, start + 1, start + 12.4999];
    for (const t of samples) {
      if (t >= total) continue;
      const r = progressBucket(t, total, 4);
      assert.equal(r.index, b, `t=${t} should land in bucket ${b}`);
      assert.equal(r.start, start);
    }
  }
});

test('progressBucket: clamps to last bucket at completion and handles degenerate totals', () => {
  assert.equal(progressBucket(100, 100, 4).index, 3);
  assert.equal(progressBucket(999, 100, 4).index, 3);
  assert.deepEqual(progressBucket(5, 0, 4), { index: 0, start: 0 });
  assert.deepEqual(progressBucket(-1, 100, 4), { index: 0, start: 0 });
});

test('progressBucket: invalid bucket counts fall back to 4', () => {
  assert.equal(progressBucket(50, 100, NaN).index, 2);
  assert.equal(progressBucket(50, 100, 0).index, 2);
});

test('finishedCountAt: counts requests whose finishTime is set and <= t', () => {
  const requests = [
    { id: 'a', finishTime: 5 },
    { id: 'b', finishTime: 15 },
    { id: 'c', finishTime: null },
    { id: 'd', finishTime: undefined },
    { id: 'e', finishTime: 25.5 }
  ];
  assert.equal(finishedCountAt(requests, 0), 0);
  assert.equal(finishedCountAt(requests, 5), 1);
  assert.equal(finishedCountAt(requests, 25), 2);
  assert.equal(finishedCountAt(requests, 26), 3);
});

test('finishedCountAt: null/undefined request lists count as zero', () => {
  assert.equal(finishedCountAt(null, 10), 0);
  assert.equal(finishedCountAt(undefined, 10), 0);
  assert.equal(finishedCountAt([null], 10), 0);
});

test('#1041 regression: summary inputs do not change between request events inside one bucket', () => {
  // 24-request batch finishing one-by-one inside the first quarter.
  const requests = Array.from({ length: 24 }, (_, i) => ({
    id: `r${i}`,
    finishTime: i + 1 // finishes at t=1..24
  }));
  const total = 100;
  // Any playhead position strictly inside bucket 0 must announce identical
  // values even though up to 24 requests started/finished in that window.
  const announced = new Set();
  for (let t = 0; t < total; t += 0.5) {
    const { index, start } = progressBucket(t, total, 4);
    announced.add(`${finishedCountAt(requests, start)}|${index * 25}`);
  }
  // One distinct announcement per bucket boundary crossed (plus the initial
  // state) — not one per request event.
  assert.ok(announced.size <= 4, `expected <=4 announcements, got ${announced.size}: ${[...announced]}`);
  assert.equal([...announced][0].split('|')[0], '0', 'bucket-start counting never announces future completions');
});
