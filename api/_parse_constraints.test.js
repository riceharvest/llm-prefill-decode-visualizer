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

// --- #1061: locale-grouped numbers -----------------------------------------

test('unicode digit-grouping separators parse correctly (#1061)', () => {
  const nbsp = String.fromCharCode(0xA0);
  const narrow = String.fromCharCode(0x202F);
  const a = parseConstraints(`budget of $70${nbsp}000 dollars`);
  assert.equal(a.constraints.budgetUsdMax, 70000, `NBSP grouping got ${a.constraints.budgetUsdMax}`);
  const b = parseConstraints(`budget of $70${narrow}000 dollars`);
  assert.equal(b.constraints.budgetUsdMax, 70000, `narrow-NBSP grouping got ${b.constraints.budgetUsdMax}`);
  const c = parseConstraints('under $1 500 for llama 8b');
  assert.equal(c.constraints.budgetUsdMax, 1500);
});

test('decimal-comma budgets convert and raise an ambiguity (#1061)', () => {
  const { constraints, ambiguities } = parseConstraints('under $1,5k');
  assert.equal(constraints.budgetUsdMax, 1500, '1,5k must read as 1.5k, not 15k');
  assert.ok(ambiguities.some(a => a.field === 'budgetUsdMax'), 'decimal-comma reading must be flagged');
});

test('3-digit comma groups still parse as thousands separators', () => {
  const { constraints, ambiguities } = parseConstraints('under $2,500 dollars');
  assert.equal(constraints.budgetUsdMax, 2500);
  assert.ok(!ambiguities.some(a => a.field === 'budgetUsdMax'));
});

test('version-style spacing in model names is preserved (#1061)', () => {
  const { constraints } = parseConstraints('self-hosted qwen 3.6 27b');
  assert.equal(constraints.paramsB, 27);
  assert.equal(constraints.modelFamily, 'qwen');
});

// --- #1068: operator/notation gaps ------------------------------------------

test('">=" prefix parses minimum decode speed (#1068)', () => {
  assert.equal(parseConstraints('>= 30 tok/s').constraints.minDecodeTokPerSec, 30);
  assert.equal(parseConstraints('llama 8b with >=30 tok/s').constraints.minDecodeTokPerSec, 30);
});

test('"≥" parses minimum decode speed like "≤" does for VRAM (#1068)', () => {
  const { constraints } = parseConstraints('qwen 27b ≥ 40 tok/s decode');
  assert.equal(constraints.minDecodeTokPerSec, 40);
});

test('trillion parameter tags convert to billions instead of dropping (#1068)', () => {
  const { constraints } = parseConstraints('a self-hosted model with 1t parameters');
  assert.equal(constraints.paramsB, 1000);
  assert.equal(parseConstraints('phi-3 mini under $500').constraints.paramsB, null,
    'budget stripping must still win over the t-suffix match');
});

test('"8-bit" quants are not mistaken for trillion params (#1068)', () => {
  const { constraints } = parseConstraints('gemma 12b at 8-bit under $2.5k');
  assert.equal(constraints.paramsB, 12);
});

test('unmatched numeric comparison raises an ambiguity signal (#1068)', () => {
  const { ambiguities } = parseConstraints('self-hosted qwen 27b > 100 req');
  const hit = ambiguities.find(a => a.field === 'input' && /comparison/i.test(a.message));
  assert.ok(hit, 'a comparator that mapped nowhere must be reported');
});
