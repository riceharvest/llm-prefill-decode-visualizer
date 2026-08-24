// Tests for issue #853: legacy GPT-2-style configs (n_layer/n_embd/n_head/
// n_ctx) must resolve instead of falling through to the gated/private 403.
// global.fetch is stubbed so these are fully offline.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModel } from './_hfconfig.js';

const realFetch = globalThis.fetch;

function stubFetch(config, info) {
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes('resolve/main/config.json') ? config : info)
  });
}

beforeEach(() => {});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('#853: legacy GPT-2-style config resolves via n_layer/n_embd/n_head', async () => {
  stubFetch(
    { n_layer: 12, n_embd: 768, n_head: 12, n_ctx: 1024, n_positions: 1024 },
    { safetensors: { total: 124439808 } }
  );
  const r = await resolveModel('legacy-org/gpt2-style-a');
  assert.equal(r.architecture.numLayers, 12);
  assert.equal(r.architecture.hiddenSize, 768);
  assert.equal(r.architecture.numHeads, 12);
  assert.equal(r.architecture.kvHeads, 12);
  assert.equal(r.architecture.headDim, 64);
  assert.equal(r.architecture.maxContextLength, 1024);
  assert.equal(r.paramsTotal, 124439808);
  assert.ok(r.notes.some(n => n.includes('legacy GPT-2-style')), JSON.stringify(r.notes));
});

test('#853: n_ctx used for context length when n_positions absent', async () => {
  stubFetch({ n_layer: 24, n_embd: 1024, n_head: 16, n_ctx: 2048 }, {});
  const r = await resolveModel('legacy-org/gpt2-style-b');
  assert.equal(r.architecture.numLayers, 24);
  assert.equal(r.architecture.maxContextLength, 2048);
});

test('#853: modern configs keep working, no legacy note', async () => {
  stubFetch(
    { num_hidden_layers: 4, hidden_size: 256, num_attention_heads: 8,
      num_key_value_heads: 2, max_position_embeddings: 4096 },
    { safetensors: { total: 9_000_000 } }
  );
  const r = await resolveModel('modern-org/model-c');
  assert.equal(r.architecture.numLayers, 4);
  assert.equal(r.architecture.maxContextLength, 4096);
  assert.equal(r.notes.filter(n => n.includes('legacy')).length, 0);
});

test('#853: mixed config (modern arch + n_ctx-only context) reads the context', async () => {
  stubFetch({ num_hidden_layers: 2, hidden_size: 64, num_attention_heads: 4, n_ctx: 512 }, {});
  const r = await resolveModel('mixed-org/model-d');
  assert.equal(r.architecture.maxContextLength, 512);
  assert.equal(r.notes.filter(n => n.includes('legacy')).length, 0);
});
