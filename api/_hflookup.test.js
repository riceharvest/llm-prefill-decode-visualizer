import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HF_ARCH_TABLE, lookupHfArch, guessArchFromName } from './_hflookup.js';

test('table entries are internally consistent (arch fields present, params positive)', () => {
  for (const entry of HF_ARCH_TABLE) {
    assert.ok(entry.pattern instanceof RegExp, `${entry.family}: pattern`);
    assert.equal(typeof entry.family, 'string');
    for (const key of ['numLayers', 'hiddenSize', 'numHeads', 'kvHeads', 'headDim']) {
      assert.ok(Number.isInteger(entry.arch[key]) && entry.arch[key] > 0, `${entry.family}: arch.${key}`);
    }
    assert.ok(entry.arch.kvHeads <= entry.arch.numHeads, `${entry.family}: kvHeads <= numHeads`);
    assert.ok(Number.isFinite(entry.paramsTotal) && entry.paramsTotal > 0, `${entry.family}: paramsTotal`);
  }
});

test('covers the four common families the issue names', () => {
  const families = HF_ARCH_TABLE.map(e => e.pattern.source).join('|');
  assert.match(families, /qwen3/);
  assert.match(families, /llama/);
  assert.match(families, /gemma/);
  assert.match(families, /mistral/);
});

test('lookupHfArch resolves real-world ids across all four families', () => {
  // llama
  let hit = lookupHfArch('meta-llama/Llama-3.1-8B-Instruct');
  assert.equal(hit.source, 'builtin-table');
  assert.equal(hit.architecture.numLayers, 32);
  assert.equal(hit.architecture.kvHeads, 8);
  assert.equal(hit.paramsTotal, 8_030_269_440);

  hit = lookupHfArch('meta-llama/Meta-Llama-3-70B-Instruct'); // plain Llama 3 → NOT the 3.1 entry… but 70B isn't tabled for plain 3
  assert.equal(hit, null); // documented limit: only tabled sizes resolve

  hit = lookupHfArch('meta-llama/Llama-3.1-70B-Instruct');
  assert.equal(hit.architecture.numLayers, 80);

  hit = lookupHfArch('unsloth/Llama-3.2-3B-Instruct');
  assert.equal(hit.architecture.numLayers, 28);

  // qwen3
  hit = lookupHfArch('Qwen/Qwen3-8B');
  assert.equal(hit.architecture.numLayers, 36);
  hit = lookupHfArch('Qwen/Qwen3-30B-A3B'); // MoE before dense-looking prefix
  assert.equal(hit.family, 'qwen3-30b-a3b (MoE)');
  assert.equal(hit.architecture.kvHeads, 4);
  hit = lookupHfArch('Qwen/Qwen3-0.6B');
  assert.equal(hit.architecture.hiddenSize, 1024);

  // gemma
  hit = lookupHfArch('google/gemma-3-27b-it');
  assert.equal(hit.architecture.numLayers, 62);
  assert.equal(hit.architecture.headDim, 128);
  hit = lookupHfArch('google/gemma-2-9b-it');
  assert.equal(hit.architecture.headDim, 256);
  assert.equal(hit.architecture.kvHeads, 8);

  // mistral
  hit = lookupHfArch('mistralai/Mistral-7B-Instruct-v0.3');
  assert.equal(hit.architecture.numLayers, 32);
  hit = lookupHfArch('mistralai/Mixtral-8x7B-Instruct-v0.1');
  assert.equal(hit.family, 'mixtral-8x7b (MoE)');
});

test('lookupHfArch is case-insensitive and ignores the org', () => {
  assert.equal(lookupHfArch('SOME-ORG/qwen3-14b-finetune').architecture.numLayers, 40);
});

test('lookupHfArch returns null for non-matching or malformed ids', () => {
  assert.equal(lookupHfArch('org/something-else-12b'), null);
  assert.equal(lookupHfArch('no-slash'), null);
  assert.equal(lookupHfArch(''), null);
  assert.equal(lookupHfArch(null), null);
});

test('guessArchFromName parses size tags into documented buckets', () => {
  assert.deepEqual(
    { layers: guessArchFromName('org/Foo-8B-chat').architecture.numLayers, params: guessArchFromName('org/Foo-8B-chat').paramsTotal },
    { layers: 32, params: 8_000_000_000 }
  );
  assert.equal(guessArchFromName('org/Foo-13B').architecture.numLayers, 48);
  assert.equal(guessArchFromName('org/Foo-30B-A3B').architecture.numLayers, 64);
  assert.equal(guessArchFromName('org/Foo-72B-Instruct').architecture.numLayers, 80);
  // decimal tags work too
  assert.equal(guessArchFromName('org/Tiny-1.5B').paramsTotal, 1_500_000_000);
});

test('guessArchFromName returns null without a parseable size anchor', () => {
  assert.equal(guessArchFromName('org/no-size-here'), null);
  assert.equal(guessArchFromName('org/v2-final'), null);
  assert.equal(guessArchFromName(null), null);
});

test('guessArchFromName treats experts×size tags as the MoE total (#1073)', () => {
  // Mixtral-8x7B used to parse as 7B (the last plain tag) — 6.7x low.
  const mixtral = guessArchFromName('mistralai/Mixtral-8x7B-Instruct-v0.1');
  assert.equal(mixtral.paramsTotal, 56_000_000_000);
  assert.equal(mixtral.architecture.numLayers, 80);
  assert.ok(mixtral.notes.some((n) => n.includes('Mixture-of-Experts')));
  const big = guessArchFromName('org/Foo-8x22B');
  assert.equal(big.paramsTotal, 176_000_000_000);
});

test('guessArchFromName never reports an active-parameter tag as total (#1073)', () => {
  // Active-only id (no total tag): fail loudly instead of inventing one.
  assert.equal(guessArchFromName('Qwen/Qwen1.5-MoE-A2.7B'), null);
  // Total + active id: the TOTAL tag wins, active tag is ignored.
  const qwen3 = guessArchFromName('Qwen/Qwen3-30B-A3B');
  assert.equal(qwen3.paramsTotal, 30_000_000_000);
  assert.equal(qwen3.architecture.numLayers, 64);
});
