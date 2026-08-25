// Tests for the shared anchored quant-tag scanner (#1071).
//
// Contract under test: /api/sizing (bitsPerWeight) and /api/best?fitCheck
// (quantBitsPerWeight) must resolve the SAME weight-storage component of any
// tag — mixed/composite tags previously latched onto different substrings
// (INT4 vs BF16), a 4× weight-size disagreement between endpoints.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateQuantComponent, quantTagIsComposite } from '../_quant_tag.js';
import { bitsPerWeight } from './sizing.js';
import { quantBitsPerWeight, DEFAULT_FALLBACK_BITS } from '../_vramfit.js';

const REPRO_TAG = 'GPTQ-INT4-G64-sym-local+DFlash-BF16-local';

test('locateQuantComponent: finds the issue #1071 repro component', () => {
  const loc = locateQuantComponent(REPRO_TAG);
  assert.ok(loc);
  assert.equal(loc.kind, 'int');
  assert.equal(loc.text.toLowerCase(), 'int4');
  assert.equal(loc.bitBase, 4);
});

test('locateQuantComponent: earliest component wins regardless of family', () => {
  const loc = locateQuantComponent('bf16-weights+int4-draft'); // f16 listed first
  assert.equal(loc.kind, 'f16');
  const loc2 = locateQuantComponent('q6_k+fp8-kv'); // gguf listed first
  assert.equal(loc2.kind, 'gguf');
  assert.equal(loc2.text, 'q6_k');
});

test('locateQuantComponent: garbage/null safe', () => {
  assert.equal(locateQuantComponent(null), null);
  assert.equal(locateQuantComponent(''), null);
  assert.equal(locateQuantComponent('symmetric-grouped'), null);
});

test('quantTagIsComposite: true for multi-component tags', () => {
  assert.equal(quantTagIsComposite(REPRO_TAG), true);
  assert.equal(quantTagIsComposite('bf16+int4'), true);
  assert.equal(quantTagIsComposite('q4_k_m'), false);
  assert.equal(quantTagIsComposite('bf16'), false);
  assert.equal(quantTagIsComposite('nonsense'), false);
});

test('PARITY: both endpoints resolve the same bpw class on the #1071 repro', () => {
  const sizingBpw = bitsPerWeight(REPRO_TAG);
  const bestBpw = quantBitsPerWeight(REPRO_TAG);
  // Same storage component (INT4): sizing's plain-digit row vs _vramfit's
  // effective-rate row — constants may drift (#1025) but must stay within one
  // table-row of each other, never the old 4-vs-16 (4×) latch.
  assert.equal(sizingBpw, 4);
  assert.equal(bestBpw, 4.5);
});

test('PARITY across mixed-tag corpus: no endpoint picks different components', () => {
  const tags = [
    REPRO_TAG,
    'awq-int4-groupwise+spec-decode-bf16',
    'bf16-weights+int8-kv',
    'q4_k_m+draft-fp8',
    'fp8-base+half-draft'
  ];
  for (const tag of tags) {
    const s = bitsPerWeight(tag);
    const b = quantBitsPerWeight(tag) ?? DEFAULT_FALLBACK_BITS;
    const ratio = Math.max(s, b) / Math.min(s, b);
    assert.ok(
      ratio <= 1.25,
      `${tag}: sizing=${s} best=${b} — components diverged (ratio ${ratio.toFixed(2)})`
    );
  }
});

test('single-tag behavior unchanged (regression pins)', () => {
  // sizing
  assert.equal(bitsPerWeight('Q4_K_M'), 4.25);
  assert.equal(bitsPerWeight('q8_0'), 8);
  assert.equal(bitsPerWeight('fp16'), 16);
  assert.equal(bitsPerWeight('4bit'), 4.25);
  assert.equal(bitsPerWeight(undefined), 4.25);
  // vramfit
  assert.equal(quantBitsPerWeight('q4_k_m'), 4.5);
  assert.equal(quantBitsPerWeight('bf16'), 16);
  assert.equal(quantBitsPerWeight('4bit'), 4.5);
  assert.equal(quantBitsPerWeight('q8_0'), 8.5);
  assert.equal(quantBitsPerWeight('exl2'), null);
});
