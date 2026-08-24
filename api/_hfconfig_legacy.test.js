// Regression tests for agent-farm issues #853 + #854.
//
// #853 — /api/vram 403s on PUBLIC legacy GPT-2-style repos because
//        n_layer/n_embd/n_head/n_ctx configs are unmapped.
// #854 — fits.maxContextTokens ignores the model's own context window and
//        contradicts contextWindow.withinLimit in the same response.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLegacyConfigKeys } from './_hfconfig.js';

// GPT-2 config.json shape (openai-community/gpt2)
const GPT2_CONFIG = {
  n_ctx: 1024,
  n_embd: 768,
  n_head: 12,
  n_layer: 12,
  n_positions: 1024,
  vocab_size: 50257
};

test('#853: legacy GPT-2 keys map onto modern equivalents', () => {
  const { config, legacyKeysUsed } = mapLegacyConfigKeys(GPT2_CONFIG);
  assert.equal(config.num_hidden_layers, 12);
  assert.equal(config.hidden_size, 768);
  assert.equal(config.num_attention_heads, 12);
  assert.equal(config.max_position_embeddings, 1024);
  // modern key present → alias untouched
  assert.equal(config.n_layer, 12);
  const mapped = new Set(legacyKeysUsed.map(s => s.split('→')[1]));
  for (const k of ['num_hidden_layers', 'hidden_size', 'num_attention_heads', 'max_position_embeddings']) {
    assert.ok(mapped.has(k), `expected ${k} backfilled`);
  }
});

test('#853: modern keys win over legacy spellings', () => {
  const { config, legacyKeysUsed } = mapLegacyConfigKeys({
    num_hidden_layers: 40,
    hidden_size: 5120,
    num_attention_heads: 40,
    max_position_embeddings: 8192,
    n_layer: 12,
    n_embd: 768,
    n_head: 12,
    n_ctx: 1024
  });
  assert.equal(config.num_hidden_layers, 40);
  assert.equal(config.hidden_size, 5120);
  assert.equal(config.num_attention_heads, 40);
  assert.equal(config.max_position_embeddings, 8192);
  assert.deepEqual(legacyKeysUsed, []);
});

test('#853: non-numeric legacy values are ignored', () => {
  const { config, legacyKeysUsed } = mapLegacyConfigKeys({ n_layer: 'many', n_embd: null });
  assert.equal(config.num_hidden_layers, undefined);
  assert.equal(config.hidden_size, undefined);
  assert.deepEqual(legacyKeysUsed, []);
});

test('#853: empty/non-object input yields empty mapping', () => {
  for (const input of [null, undefined, {}, 42]) {
    const { config, legacyKeysUsed } = mapLegacyConfigKeys(input ?? {});
    assert.deepEqual(legacyKeysUsed, []);
    assert.equal(typeof config, 'object');
  }
});
