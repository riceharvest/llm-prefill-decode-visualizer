import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleTurn, speculative, batched, agentic, nonPositiveSpeedWarnings } from './_math.js';

test('nonPositiveSpeedWarnings: positive speeds → empty', () => {
  assert.deepEqual(nonPositiveSpeedWarnings({ prefillSpeed: 3800, decodeSpeed: 105 }), []);
});

test('nonPositiveSpeedWarnings: zero and negative speeds each warn (#444)', () => {
  const w = nonPositiveSpeedWarnings({ prefillSpeed: 0, decodeSpeed: -105 });
  assert.deepEqual(w.map(x => x.code).sort(), ['decode_speed_nonpositive', 'prefill_speed_nonpositive']);
  for (const x of w) {
    assert.equal(typeof x.message, 'string');
    assert.ok(x.message.length > 20);
  }
});

test('singleTurn: decodeSpeed=0 keeps degenerate metrics but now carries a machine-readable warning (#444)', () => {
  const r = singleTurn({ promptTokens: 100, outputTokens: 10, prefillSpeed: 3800, decodeSpeed: 0 });
  assert.ok([Infinity, null].includes(r.tpotMs), `tpotMs=${r.tpotMs}`);
  assert.ok(r.warnings.some(w => w.code === 'decode_speed_nonpositive'), JSON.stringify(r.warnings));
});

test('speculative: negative base speed no longer prints a >1 speedup silently (#444)', () => {
  const r = speculative({ baseDecodeSpeed: -105, draftTokens: 4, acceptanceRate: 0.7 });
  // The math itself is untouched (wire-stable); the contradiction is now flagged.
  assert.ok(r.effectiveDecodeTokPerSec < 0);
  assert.ok(r.speedupVsVanilla > 1);
  assert.ok(
    r.warnings.some(w => w.code === 'decode_speed_nonpositive'),
    `expected decode_speed_nonpositive in ${JSON.stringify(r.warnings)}`
  );
});

test('speculative: draftTokens below 1 is clamped loudly (#444)', () => {
  const r = speculative({ baseDecodeSpeed: 105, draftTokens: -3 });
  assert.equal(r.inputs.draftTokens, 1);
  const w = r.warnings.find(x => x.code === 'draft_tokens_clamped_to_minimum');
  assert.ok(w, 'expected draft_tokens_clamped_to_minimum');
  assert.match(w.message, /-3/);
});

test('plausible inputs still produce an empty warnings array (no false positives)', () => {
  assert.deepEqual(singleTurn({}).warnings, []);
  assert.deepEqual(batched({ batchSize: 16 }).warnings, []);
  assert.deepEqual(speculative({ baseDecodeSpeed: 105, draftTokens: 4 }).warnings, []);
  assert.deepEqual(agentic({ numTurns: 2 }).warnings, []);
});
