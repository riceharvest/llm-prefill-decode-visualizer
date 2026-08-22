import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditRun, auditRuns, dataQuality } from './_unit_audit.js';
import { validateSubmission } from './_submit.js';

const cleanRun = (over = {}) => ({
  runId: 'r1', hwClass: 'discrete_gpu', gpuCount: 1,
  prefillTokPerSec: 800, decodeTokPerSec: 60, ...over
});

test('clean run passes with no flags', () => {
  const a = auditRun(cleanRun());
  assert.equal(a.ok, true);
  assert.deepEqual(a.flags, []);
});

test('decode above bandwidth roofline is flagged as error', () => {
  const a = auditRun(cleanRun({ decodeTokPerSec: 5_000 }));
  assert.equal(a.ok, false);
  const f = a.flags.find(x => x.code === 'decode_above_roofline');
  assert.ok(f, 'expected decode_above_roofline');
  assert.equal(f.severity, 'error');
  assert.equal(f.observed, 5000);
  assert.equal(f.limit, 400); // discrete_gpu roofline × 1 GPU
  assert.match(f.message, /roofline/);
});

test('roofline scales with gpuCount for multi-GPU rigs', () => {
  // 2×400 = 800 ceiling: 700 tok/s total is plausible for a 2-GPU rig…
  assert.equal(auditRun(cleanRun({ gpuCount: 2, decodeTokPerSec: 700 })).ok, true);
  // …but 900 tok/s is not.
  const a = auditRun(cleanRun({ gpuCount: 2, decodeTokPerSec: 900 }));
  assert.ok(a.flags.some(x => x.code === 'decode_above_roofline'));
  assert.equal(a.flags[0].limit, 800);
});

test('per-hwClass thresholds differ (cpu_only roofline is far lower)', () => {
  const a = auditRun({ hwClass: 'cpu_only', prefillTokPerSec: 50, decodeTokPerSec: 120 });
  assert.ok(a.flags.some(x => x.code === 'decode_above_roofline'));
  assert.equal(a.flags.find(x => x.code === 'decode_above_roofline').limit, 50);
});

test('unknown hwClass falls back to default thresholds', () => {
  const a = auditRun({ hwClass: null, prefillTokPerSec: 300, decodeTokPerSec: 999 });
  assert.ok(a.flags.some(x => x.code === 'decode_above_roofline'));
  assert.match(a.flags[0].message, /unknown hardware class/);
});

test('decode below floor flags probable ms/token unit error', () => {
  const a = auditRun(cleanRun({ decodeTokPerSec: 0.01 }));
  const f = a.flags.find(x => x.code === 'decode_below_floor');
  assert.ok(f, 'expected decode_below_floor');
  assert.equal(f.severity, 'warning');
  assert.match(f.message, /ms\/token/);
});

test('prefill below floor flags implausibly slow prefill (issue example)', () => {
  // 'prefill 5 tok/s on an H100?'
  const a = auditRun(cleanRun({ prefillTokPerSec: 5 }));
  const f = a.flags.find(x => x.code === 'prefill_below_floor');
  assert.ok(f, 'expected prefill_below_floor');
  assert.equal(f.field, 'prefillTokPerSec');
  assert.equal(f.observed, 5);
  assert.equal(f.limit, 10);
});

test('prefill below decode is flagged as impossible single-stream result', () => {
  const a = auditRun(cleanRun({ prefillTokPerSec: 30, decodeTokPerSec: 90 }));
  assert.equal(a.ok, false);
  const f = a.flags.find(x => x.code === 'prefill_below_decode');
  assert.ok(f, 'expected prefill_below_decode');
  assert.equal(f.severity, 'error');
});

test('missing or blank speed fields are ignored, not flagged', () => {
  assert.equal(auditRun({}).ok, true);
  assert.equal(auditRun({ hwClass: 'discrete_gpu' }).ok, true);
  assert.equal(auditRun(null).ok, true);
});

test('auditRuns summarizes flagged runs and counts flag codes', () => {
  const runs = [
    cleanRun({ runId: 'ok-1' }),
    cleanRun({ runId: 'bad-1', decodeTokPerSec: 9_999 }),
    cleanRun({ runId: 'bad-2', prefillTokPerSec: 2, decodeTokPerSec: 4 }),
    cleanRun({ runId: 'bad-3', prefillTokPerSec: 1 })
  ];
  const s = auditRuns(runs);
  assert.equal(s.runsAudited, 4);
  assert.equal(s.flaggedRuns, 3);
  assert.equal(s.ok, false);
  assert.equal(s.flagCounts.decode_above_roofline, 1);          // bad-1
  assert.equal(s.flagCounts.prefill_below_decode, 3);           // bad-1, bad-2, bad-3 (default decode 60 > tiny prefill)
  assert.equal(s.flagCounts.prefill_below_floor, 2);            // bad-2, bad-3
  assert.deepEqual(s.flagged.map(f => f.runId), ['bad-1', 'bad-2', 'bad-3']);
});

test('auditRuns on empty/non-array input is ok', () => {
  assert.deepEqual(
    { ...auditRuns([]), flagged: [] },
    { ok: true, runsAudited: 0, flaggedRuns: 0, flagCounts: {}, flagged: [] }
  );
  assert.equal(auditRuns(undefined).runsAudited, 0);
});

test('dataQuality reduces flagged entries to codes and sets status', () => {
  const dq = dataQuality([
    cleanRun(),
    cleanRun({ runId: 'x', decodeTokPerSec: 9_999, prefillTokPerSec: 3 })
  ]);
  assert.equal(dq.status, 'flagged');
  assert.equal(dq.flaggedRuns, 1);
  assert.deepEqual(
    dq.flagged,
    [{ runId: 'x', codes: ['decode_above_roofline', 'prefill_below_floor', 'prefill_below_decode'] }]
  );

  assert.equal(dataQuality([cleanRun()]).status, 'ok');
});

// ---------- Ingest integration (validateSubmission) ----------

test('validateSubmission attaches a passing unitAudit to a clean submission', () => {
  const r = validateSubmission({
    model: 'llama-3-8b', quant: 'q4_k_m', hardware: 'RTX 4090',
    hwClass: 'discrete_gpu', prefillTokPerSec: 2500, decodeTokPerSec: 55
  });
  assert.equal(r.ok, true);
  assert.equal(r.submission.unitAudit.ok, true);
  assert.deepEqual(r.submission.unitAudit.flags, []);
});

test('validateSubmission flags borderline magnitudes without rejecting them', () => {
  // Passes the coarse schema bounds (positive, under class ceilings,
  // decode < prefill) but trips two unit-consistency audits.
  const r = validateSubmission({
    model: 'deepseek-r1', quant: 'q4', hardware: 'H100',
    hwClass: 'discrete_gpu', prefillTokPerSec: 5, decodeTokPerSec: 0.15
  });
  assert.equal(r.ok, true, 'advisory flags must not reject the submission');
  const codes = r.submission.unitAudit.flags.map(f => f.code).sort();
  assert.deepEqual(codes, ['decode_below_floor', 'prefill_below_floor']);
});

test('inverted speeds are hard-rejected by schema bounds before the audit', () => {
  const r = validateSubmission({
    model: 'm', quant: 'q4', hardware: 'H100',
    hwClass: 'discrete_gpu', prefillTokPerSec: 30, decodeTokPerSec: 90
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'implausible'));
});

test('hard rejection still happens before the audit can matter', () => {
  const r = validateSubmission({
    model: 'm', quant: 'q4', hardware: 'H100',
    hwClass: 'discrete_gpu', prefillTokPerSec: 2_000_000, decodeTokPerSec: 10
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'implausible'));
});
