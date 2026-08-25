import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_ID_HINT,
  formatSecondsAuto,
  runMetaLine,
  diffStatusState,
  buildDiffTableRows
} from './runDiffView.js';

test('#387 hint carries the exact working run-id recipe', () => {
  assert.match(RUN_ID_HINT, /GET \/api\/localmaxxing\?hardware=<name>&limit=N/);
  assert.match(RUN_ID_HINT, /items\[\]\.runId/);
});

test('#394 sub-millisecond times are no longer rounded to zero', () => {
  // Real repro from the issue: decode 6,320 vs 5,861 tok/s → µs-scale TPOT.
  const tpotA = formatSecondsAuto(1 / 6320);
  const tpotB = formatSecondsAuto(1 / 5861);
  assert.ok(/µs/.test(tpotA), `expected µs scaling, got ${tpotA}`);
  assert.notEqual(tpotA, '0 s');
  assert.notEqual(tpotB, '0 s');
  assert.equal(formatSecondsAuto(0), '0 s');
  assert.equal(formatSecondsAuto(0.28), '280 ms');
  assert.equal(formatSecondsAuto(0.5391).replace(/,/g, ''), '539.1 ms');
  assert.equal(formatSecondsAuto(9.187769), '9.188 s');
  assert.equal(formatSecondsAuto(null), '—');
  assert.equal(formatSecondsAuto(Number.NaN), '—');
});

test('#394 the two fast runs produce distinct, nonzero display strings', () => {
  const a = formatSecondsAuto(1 / 6320);
  const b = formatSecondsAuto(1 / 5861);
  assert.notEqual(a, b);
});

test('#391 meta line joins model/quant/engine/hardware/date', () => {
  const line = runMetaLine('A', {
    modelName: 'Qwen 3 32B',
    quantization: 'q4_k_m',
    engine: 'llama.cpp',
    engineVersion: 'b4120',
    hardware: 'AMD Ryzen 7 9800X3D',
    createdAt: '2026-08-20T14:03:11.000Z'
  });
  assert.match(line, /^A: Qwen 3 32B · q4_k_m · llama\.cpp b4120 · AMD Ryzen 7 9800X3D · 2026-08-20$/);
});

test('#391 meta line falls back to em dashes for missing fields and null for absent run', () => {
  assert.match(runMetaLine('B', {}), /^B: — · — · — · — · —$/);
  assert.equal(runMetaLine('B', null), null);
  assert.match(runMetaLine('A', { modelFamily: 'qwen3' }), /^A: qwen3 ·/);
});

test('#390 status state machine covers idle/loading/done/error', () => {
  assert.deepEqual(diffStatusState({ loading: false, result: null, error: '' }), { state: 'idle', announcement: '' });
  assert.deepEqual(diffStatusState({ loading: true, result: null, error: '' }), { state: 'loading', announcement: 'Diffing runs…' });
  const done = diffStatusState({ loading: false, result: {}, error: '' });
  assert.equal(done.state, 'done');
  assert.ok(done.announcement.length > 0);
  const err = diffStatusState({ loading: false, result: null, error: 'run x not found' });
  assert.equal(err.state, 'error');
  assert.equal(err.announcement, 'run x not found');
  // loading wins over stale result/error so agents can tell "still working"
  assert.equal(diffStatusState({ loading: true, result: {}, error: '' }).state, 'loading');
});

const payload = {
  diff: {
    metrics: {
      prefill: { a: 7311, b: 7373, delta: 62, deltaPct: 0.0085, ratio: 1.01, winner: 'B' },
      decode: { a: 6320, b: 5861, delta: -459, deltaPct: -0.0726, ratio: 0.93, winner: 'A' },
      ttft: { a: 0.28, b: 0.278, delta: -0.002, deltaPct: -0.0071, ratio: 0.99, winner: 'B' },
      tpot: { a: 1 / 6320, b: 1 / 5861, delta: 0, deltaPct: 0, ratio: 1.08, winner: 'A' },
      walltime: { a: 0.3798, b: 0.3801, delta: 0, deltaPct: 0, ratio: 1, winner: 'tie' }
    }
  }
};

test('#388 table rows expose raw numeric values for every metric', () => {
  const rows = buildDiffTableRows(payload);
  assert.equal(rows.length, 5);
  const tpot = rows.find(r => r.key === 'tpot');
  assert.equal(tpot.a.toFixed(10), (1 / 6320).toFixed(10));
  assert.equal(tpot.b > 0, true);
  assert.equal(typeof rows.find(r => r.key === 'decode').deltaPct, 'number');
});

test('#388 rows degrade safely on empty/garbage payloads', () => {
  assert.deepEqual(buildDiffTableRows(null), []);
  assert.deepEqual(buildDiffTableRows({}), []);
  const rows = buildDiffTableRows({ diff: { metrics: {} } });
  assert.equal(rows.length, 5);
  assert.ok(rows.every(r => r.a === null && r.b === null && r.winner === null));
});
