import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuant, QUANT_ENUM, QUANT_CATALOG } from './_quant.js';

test('#882: q4_0 matches and resolves to its own canonical key at 4.55 bpw', () => {
  const r = resolveQuant('q4_0');
  assert.equal(r.key, 'q4_0');
  assert.equal(r.bpw, 4.55);
  assert.equal(r.assumed, false);
});

test('#882: q4_1 keeps its own canonical key (no longer mislabeled q4_0)', () => {
  const r = resolveQuant('q4_1');
  assert.equal(r.key, 'q4_1');
  assert.equal(r.bpw, 4.55);
  assert.equal(r.assumed, false);
});

test('#882: separator/case variants of q4_0 still match', () => {
  for (const tag of ['q4', 'Q4', 'q40', 'q4 0', 'q4_0']) {
    const r = resolveQuant(tag);
    assert.equal(r.key, 'q4_0', `tag ${tag}`);
    assert.equal(r.assumed, false);
  }
});

test('q4_k_m is unaffected by the q4_0/q4_1 split', () => {
  const r = resolveQuant('q4_k_m');
  assert.equal(r.key, 'q4_k_m');
  assert.equal(r.bpw, 4.85);
});

test('unknown tags are echoed back and flagged as assumed', () => {
  const r = resolveQuant('garbage123');
  assert.equal(r.key, 'garbage123');
  assert.equal(r.assumed, true);
});

test('QUANT_ENUM lists every canonical tag exactly once, incl. q4_0 and q4_1', () => {
  assert.equal(new Set(QUANT_ENUM).size, QUANT_ENUM.length);
  for (const tag of QUANT_ENUM) {
    const r = resolveQuant(tag);
    assert.equal(r.key, tag, `enum tag ${tag} must self-resolve`);
    assert.equal(r.assumed, false);
  }
  assert.ok(QUANT_ENUM.includes('q4_0'));
  assert.ok(QUANT_ENUM.includes('q4_1'));
});

test('QUANT_CATALOG carries a positive bitsPerWeight per tag', () => {
  for (const entry of QUANT_CATALOG) {
    assert.equal(typeof entry.bitsPerWeight, 'number');
    assert.ok(entry.bitsPerWeight > 0 && entry.bitsPerWeight <= 32);
  }
});
