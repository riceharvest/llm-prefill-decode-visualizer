import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from './_handlers/vram.js';

// Issue #853: legacy GPT-2-style configs (n_layer / n_embd / n_head /
// n_positions) must resolve via config.json instead of falling through to a
// misleading 403 "gated/private".
// Issue #854: fits.maxContextTokens must be clamped to the model's own
// context window instead of reporting bounds larger than max_position_embeddings.

const LEGACY_CONFIG = {
  // GPT-2-era field names only — no modern num_hidden_layer* keys.
  n_layer: 12,
  n_embd: 768,
  n_head: 12,
  n_positions: 1024,
  vocab_size: 50257
};

const MODERN_CONFIG = {
  num_hidden_layers: 32,
  hidden_size: 4096,
  num_attention_heads: 32,
  num_key_value_heads: 8,
  max_position_embeddings: 32768
};

function hfFetchStub({ config, safetensorsTotal = null, siblings = [] }) {
  return async (url) => {
    if (String(url).endsWith('/config.json')) {
      if (config == null) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => config };
    }
    if (String(url).includes('/api/models/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ siblings, ...(safetensorsTotal != null ? { safetensors: { total: safetensorsTotal } } : {}) })
      };
    }
    return { ok: false, status: 404 };
  };
}

let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
});

function restore() {
  globalThis.fetch = realFetch;
}

function mockReq(query = {}) {
  return { url: '/api/vram', method: 'GET', query, headers: {}, socket: { remoteAddress: '10.0.0.1' } };
}

function mockRes() {
  const chunks = [];
  return {
    statusCode: null,
    headers: {},
    bodyText: '',
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    write(c) { chunks.push(String(c)); },
    end(c) { if (c != null) chunks.push(String(c)); this.bodyText = chunks.join(''); this.ended = true; }
  };
}

test('#853: legacy GPT-2 config.json fields resolve without a 403', async () => {
  try {
    globalThis.fetch = hfFetchStub({
      config: LEGACY_CONFIG,
      safetensorsTotal: 124439808
    });
    const res = mockRes();
    await handler(mockReq({ hfId: 'legacy-tests/gpt2-style-no-modern-keys' }), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.model.resolutionSource, 'huggingface');
    assert.equal(body.model.architecture.numLayers, 12);
    assert.equal(body.model.architecture.hiddenSize, 768);
    assert.equal(body.model.architecture.numHeads, 12);
    assert.equal(body.model.architecture.kvHeads, 12); // falls back to numHeads
    assert.equal(body.model.architecture.headDim, 64); // n_embd / n_head
    assert.equal(body.model.architecture.maxContextLength, 1024); // n_positions
    // Weights resolved from HF metadata × quant, not file size.
    assert.equal(body.weights.sourceKind, 'params×quant');
    assert.ok(body.weights.gb > 0);
    // KV math uses the mapped dims.
    assert.match(body.kvCache.formula, /12 layers × 12 KV heads × 64 dim/);
  } finally { restore(); }
});

test('#853: unmapped public repo no longer claims gated/private', async () => {
  try {
    globalThis.fetch = hfFetchStub({ config: { model_type: 'mystery' }, siblings: [] });
    const res = mockRes();
    await handler(mockReq({ hfId: 'legacy-tests/unreadable-config-public' }), res);
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.bodyText);
    assert.match(body.error, /is public but its config\.json has no readable architecture fields/);
    assert.doesNotMatch(body.error, /gated\/private/);
  } finally { restore(); }
});

test('#853: modern configs keep resolving identically', async () => {
  try {
    globalThis.fetch = hfFetchStub({ config: MODERN_CONFIG, safetensorsTotal: 8_000_000_000 });
    const res = mockRes();
    await handler(mockReq({ hfId: 'legacy-tests/modern-config-sanity', context: '65536' }), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.model.architecture.numLayers, 32);
    assert.equal(body.model.architecture.kvHeads, 8);
    assert.equal(body.model.architecture.maxContextLength, 32768);
  } finally { restore(); }
});

test('#854: fits.maxContextTokens is clamped to the model context window', async () => {
  try {
    // Large budget vs tiny 1B-param-ish weights → VRAM-derived bound would far
    // exceed n_positions=1024 (the exact #854 contradiction).
    globalThis.fetch = hfFetchStub({
      config: LEGACY_CONFIG,
      safetensorsTotal: 124439808
    });
    const res = mockRes();
    await handler(mockReq({ hfId: 'legacy-tests/clamp-window', vramGb: '512' }), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.contextWindow.maxPositionEmbeddings, 1024);
    assert.equal(body.fits.maxContextTokens, 1024);
    assert.equal(body.fits.contextWindowCapped, true);
    assert.match(body.fits.note, /clamped to the model max_position_embeddings/);
    // The reported bound can never exceed the model's own limit anymore.
    assert.ok(body.fits.maxContextTokens <= body.contextWindow.maxPositionEmbeddings);
  } finally { restore(); }
});

test('#854: sub-window budgets stay uncapped and drop the cap flag', async () => {
  try {
    globalThis.fetch = hfFetchStub({
      config: LEGACY_CONFIG,
      safetensorsTotal: 124439808
    });
    const res = mockRes();
    await handler(mockReq({ hfId: 'legacy-tests/small-budget-uncapped', vramGb: '0.08' }), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.contextWindow.maxPositionEmbeddings, 1024);
    assert.ok(body.fits.maxContextTokens > 0);
    assert.ok(body.fits.maxContextTokens < 1024);
    assert.equal(body.fits.contextWindowCapped, undefined);
    assert.ok(!body.fits.note.includes('clamped'));
  } finally { restore(); }
});
