import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_FLAGS, applyEngineFlags, getEngineFlag, normalizeFlagIds } from './engineFlags.js';

test('no flags returns base speeds untouched with empty audit trail', () => {
  const r = applyEngineFlags({ prefillSpeed: 3800, decodeSpeed: 105, flags: [] });
  assert.equal(r.adjusted.prefillSpeed, 3800);
  assert.equal(r.adjusted.decodeSpeed, 105);
  assert.equal(r.adjusted.kvBits, 16);
  assert.deepEqual(r.adjustments, []);
  assert.deepEqual(r.warnings, []);
});

test('each flag applies its documented multiplicative delta', () => {
  for (const def of ENGINE_FLAGS) {
    const r = applyEngineFlags({ prefillSpeed: 1000, decodeSpeed: 100, flags: [def.id] });
    assert.equal(r.adjusted.prefillSpeed, Math.round(1000 * def.prefillMult), `prefill delta for ${def.id}`);
    assert.equal(r.adjusted.decodeSpeed, Math.round(100 * def.decodeMult * 10) / 10, `decode delta for ${def.id}`);
    assert.equal(r.adjustments.length, 1);
    // Every adjustment carries an explicit source tag + note so it is auditable
    assert.equal(r.adjustments[0].source, 'heuristic');
    assert.ok(r.adjustments[0].sourceNote.length > 20, `${def.id} must document its source`);
  }
});

test('flags compose multiplicatively in list order', () => {
  const single = applyEngineFlags({ prefillSpeed: 3800, decodeSpeed: 105, flags: ['flash-attn'] });
  const both = applyEngineFlags({ prefillSpeed: 3800, decodeSpeed: 105, flags: ['flash-attn', 'kv-q8'] });
  const expected = single.adjusted.prefillSpeed * 1.04;
  assert.ok(Math.abs(both.adjusted.prefillSpeed - expected) <= 1);
  assert.equal(both.adjustments.length, 2);
});

test('kv quantization flags set the effective KV bit width', () => {
  assert.equal(applyEngineFlags({ flags: ['kv-q8'] }).adjusted.kvBits, 8);
  assert.equal(applyEngineFlags({ flags: ['kv-q4'] }).adjusted.kvBits, 4);
  assert.equal(applyEngineFlags({ flags: ['vllm-fp8-kv'] }).adjusted.kvBits, 8);
  assert.equal(applyEngineFlags({ flags: ['flash-attn', 'kv-q8'] }).adjusted.kvBits, 8);
  assert.equal(applyEngineFlags({ flags: ['no-mmap'] }).adjusted.kvBits, 16);
});

test('unknown and duplicate flag ids are ignored with a warning, never throw', () => {
  const r = applyEngineFlags({ flags: ['bogus-flag', 'flash-attn', 'flash-attn'] });
  assert.match(r.warnings[0], /Unknown flag id 'bogus-flag'/);
  assert.equal(r.adjustments.length, 1);
  assert.deepEqual(r.inputs.flags, ['flash-attn']);
});

test('comma-separated string input works (URL param shape)', () => {
  const arr = applyEngineFlags({ flags: ['flash-attn', 'kv-q8'] });
  const str = applyEngineFlags({ flags: 'flash-attn,kv-q8' });
  assert.deepEqual(str.adjusted, arr.adjusted);
});

test('both multi-value encodings produce identical results (#932)', () => {
  const comma = applyEngineFlags({ prefillSpeed: 1000, decodeSpeed: 100, flags: 'flash-attn,kv-q8' });
  const repeated = applyEngineFlags({ prefillSpeed: 1000, decodeSpeed: 100, flags: ['flash-attn', 'kv-q8'] });
  assert.deepEqual(comma.inputs.flags, repeated.inputs.flags);
  assert.deepEqual(comma.adjusted, repeated.adjusted);
  assert.deepEqual(comma.warnings, repeated.warnings);
});

test('repeated-key array elements containing commas are split, not mangled (#932)', () => {
  // A layer that joins repeated keys back into one string must not poison
  // the ids into an unmatchable 'flash-attn,kv-q8' token.
  const joined = applyEngineFlags({ flags: ['flash-attn,kv-q8'] });
  const clean = applyEngineFlags({ flags: ['flash-attn', 'kv-q8'] });
  assert.deepEqual(joined.inputs.flags, ['flash-attn', 'kv-q8']);
  assert.deepEqual(joined.adjusted, clean.adjusted);
  assert.deepEqual(joined.warnings, clean.warnings);
});

test('mixed encodings, whitespace and empty parts normalize cleanly (#932)', () => {
  const r = applyEngineFlags({ flags: ['flash-attn , kv-q8', '', ' no-mmap '] });
  assert.deepEqual(r.inputs.flags, ['flash-attn', 'kv-q8', 'no-mmap']);
  assert.equal(r.adjustments.length, 3);
});

test('normalizeFlagIds handles non-array scalars and defaults', () => {
  assert.deepEqual(normalizeFlagIds('flash-attn'), ['flash-attn']);
  assert.deepEqual(normalizeFlagIds(undefined), []);
  assert.deepEqual(normalizeFlagIds(''), []);
});

test('dependent flags warn when their requirement is missing', () => {
  const r = applyEngineFlags({ flags: ['kv-q8'] });
  assert.ok(r.warnings.some(w => w.includes("requires 'flash-attn'")));
  const ok = applyEngineFlags({ flags: ['flash-attn', 'kv-q8'] });
  assert.ok(!ok.warnings.some(w => w.includes('requires')));
});

test('getEngineFlag resolves by id and returns null otherwise', () => {
  assert.equal(getEngineFlag('flash-attn').flag, '--flash-attn (-fa)');
  assert.equal(getEngineFlag('nope'), null);
});
