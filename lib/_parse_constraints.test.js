import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConstraints, constraintsToSizingQuery } from './_parse_constraints.js';

test('parses the canonical issue example', () => {
  const { input, constraints, ambiguities } =
    parseConstraints('self-hosted Qwen 27B at Q4 for 10 users under $1500');

  assert.equal(input, 'self-hosted Qwen 27B at Q4 for 10 users under $1500');
  assert.equal(constraints.deployment, 'self-hosted');
  assert.equal(constraints.modelFamily, 'qwen');
  assert.equal(constraints.paramsB, 27);
  assert.equal(constraints.quantization, 'q4');
  assert.equal(constraints.concurrency, 10);
  assert.equal(constraints.budgetUsdMax, 1500);
  // Unstated fields stay null — never silently defaulted.
  assert.equal(constraints.contextLength, null);
  assert.equal(constraints.minDecodeTokPerSec, null);
  assert.equal(constraints.maxVramGb, null);

  const fields = ambiguities.map(a => a.field);
  assert.ok(fields.includes('concurrency'), '"10 users" without "concurrent" is ambiguous');
  assert.ok(fields.includes('quantization'), 'bare Q4 without a K-variant is ambiguous');
});

test('full llama.cpp quant labels parse unambiguously', () => {
  const { constraints, ambiguities } = parseConstraints('llama 70B q4_k_m on a 48GB GPU');
  assert.equal(constraints.modelFamily, 'llama');
  assert.equal(constraints.paramsB, 70);
  assert.equal(constraints.quantization, 'q4_k_m');
  assert.equal(constraints.maxVramGb, 48);
  assert.equal(constraints.hwClass, 'discrete_gpu');
  assert.ok(!ambiguities.some(a => a.field === 'quantization'));
});

test('recognizes cloud deployment and concurrent streams', () => {
  const { constraints, ambiguities } =
    parseConstraints('cloud API for deepseek r1 with 32k context and at least 40 tok/s for 25 concurrent users');
  assert.equal(constraints.deployment, 'cloud');
  assert.equal(constraints.modelFamily, 'deepseek');
  assert.equal(constraints.contextLength, 32768);
  assert.equal(constraints.minDecodeTokPerSec, 40);
  assert.equal(constraints.concurrency, 25);
  assert.ok(!ambiguities.some(a => a.field === 'concurrency'), 'explicit "concurrent users" removes the ambiguity');
});

test('handles k-suffixed budgets and bit-word quants', () => {
  const { constraints } = parseConstraints('gemma 12b at 8-bit under $2.5k');
  assert.equal(constraints.paramsB, 12);
  assert.equal(constraints.quantization, 'q8');
  assert.equal(constraints.budgetUsdMax, 2500);
});

test('batch size phrasing sets concurrency without ambiguity flag', () => {
  const { constraints, ambiguities } = parseConstraints('mistral 7b q5_k_m batch size 8');
  assert.equal(constraints.concurrency, 8);
  assert.ok(!ambiguities.some(a => a.field === 'concurrency'));
});

test('conflicting deployment signals raise an ambiguity and stay null', () => {
  const { constraints, ambiguities } = parseConstraints('self-hosted or cloud api for llama 8b');
  assert.equal(constraints.deployment, null);
  assert.ok(ambiguities.some(a => a.field === 'deployment'));
});

test('unified-memory hardware is detected as hwClass unified', () => {
  const { constraints } = parseConstraints('run gemma locally on my macbook with 64gb memory');
  assert.equal(constraints.deployment, 'self-hosted');
  assert.equal(constraints.maxVramGb, 64);
  assert.equal(constraints.hwClass, 'unified');
});

test('nothing recognizable yields an input ambiguity, not a crash', () => {
  const { constraints, ambiguities } = parseConstraints('hello world make it fast please');
  assert.ok(Object.values(constraints).every(v => v == null));
  assert.ok(ambiguities.some(a => a.field === 'input'));
});

test('empty input flags itself', () => {
  const { constraints, ambiguities } = parseConstraints('   ');
  assert.ok(Object.values(constraints).every(v => v == null));
  assert.ok(ambiguities.some(a => a.field === 'input'));
});

test('budget amounts are not mistaken for parameter counts', () => {
  const { constraints } = parseConstraints('phi-3 mini under $500');
  assert.equal(constraints.budgetUsdMax, 500);
  assert.notEqual(constraints.paramsB, 500);
});

test('sizing query maps only mappable non-null constraints', () => {
  const { constraints } = parseConstraints('self-hosted Qwen 27B at q4_k_m for 10 users under $1500');
  const qs = constraintsToSizingQuery(constraints);
  assert.equal(qs.get('model'), 'qwen');
  assert.equal(qs.get('quant'), 'q4_k_m');
  assert.equal(qs.get('concurrency'), '10');
  assert.equal(qs.get('maxVramGb'), null, 'budgetUsdMax has no sizing param');
  assert.equal(qs.get('contextLength'), null);
});
