// #846 — singleTurn 0/0 NaN poisoning: promptTokens=0 with prefillSpeed=0
// used to yield ttft=NaN → totalWalltimeSeconds=null even though the decode
// phase was fully computable. Now a zero-prompt turn has ttft=0 and
// total = decodeSeconds, plus an explicit degenerate warning.
import test from 'node:test';
import assert from 'node:assert/strict';
import { singleTurn } from '../api/_math.js';

test('#846 repro: promptTokens=0 & prefillSpeed=0 no longer NaN-poisons the total', () => {
  const r = singleTurn({ promptTokens: 0, outputTokens: 10, prefillSpeed: 0, decodeSpeed: 105 });
  assert.equal(r.ttftSeconds, 0);
  assert.equal(r.decodeSeconds, 0.095238); // unchanged, was already valid
  assert.equal(r.totalWalltimeSeconds, 0.095238); // was null (NaN)
  const codes = r.warnings.map(w => w.code);
  assert.ok(codes.includes('degenerate_zero_prompt_ttft'), 'degenerate case is loud');
});

test('#846 zero-prompt with healthy prefill speed is byte-identical legacy behavior', () => {
  const before = singleTurn({ promptTokens: 0, outputTokens: 10, prefillSpeed: 3800, decodeSpeed: 105 });
  assert.equal(before.ttftSeconds, 0);
  assert.equal(before.totalWalltimeSeconds, 0.095238);
  assert.ok(!before.warnings.some(w => w.code === 'degenerate_zero_prompt_ttft'));
});

test('#846 genuinely impossible combo (tokens>0, speed 0) still yields null total', () => {
  const r = singleTurn({ promptTokens: 2048, outputTokens: 10, prefillSpeed: 0, decodeSpeed: 105 });
  assert.equal(r.ttftSeconds, null); // Infinity → round() → null
  assert.equal(r.totalWalltimeSeconds, null);
  assert.ok(!r.warnings.some(w => w.code === 'degenerate_zero_prompt_ttft'));
});

test('#846 defaults are untouched', () => {
  const r = singleTurn();
  assert.equal(r.ttftSeconds, Math.round((2048 / 3800) * 1e6) / 1e6);
  assert.deepEqual(r.warnings, []);
});
