import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from './vram.js';

// Stub global fetch so the handler is tested offline against a realistic
// Llama-3.1-8B-style config + HF metadata payload.
const CONFIG = {
  num_hidden_layers: 32,
  hidden_size: 4096,
  num_attention_heads: 32,
  num_key_value_heads: 8,
  head_dim: 128,
  max_position_embeddings: 131072
};

let fetchCalls = [];

function installFetch({ config = CONFIG, info = null } = {}) {
  fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    if (url.includes('/resolve/main/config.json')) {
      if (config === null) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => config };
    }
    if (url.includes('/api/models/')) {
      if (!info) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => info };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
}

beforeEach(() => {
  installFetch({
    info: {
      safetensors: { total: 8_030_269_568 },
      siblings: [{ rfilename: 'model.safetensors', size: 16_000_000_000 }]
    }
  });
});

function call({ method = 'GET', query = {}, body } = {}) {
  const req = { method, query, body };
  const res = {
    statusCode: 200, headers: {}, bodyText: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    end(p) { if (p !== undefined) this.bodyText = p; }
  };
  return handler(req, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.bodyText) }));
}

test('resolves architecture from hfId and computes combined weights+KV VRAM', async () => {
  const { status, json } = await call({
    query: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', context: '65536', quant: 'q4_k_m' }
  });
  assert.equal(status, 200);
  // Architecture resolved from the stubbed config, not supplied by the caller.
  assert.equal(json.model.architecture.numLayers, 32);
  assert.equal(json.model.architecture.hiddenSize, 4096);
  assert.equal(json.model.architecture.kvHeads, 8);       // GQA heads
  assert.equal(json.model.architecture.headDim, 128);
  assert.equal(json.model.paramsTotal, 8_030_269_568);

  // KV bytes/token = 2 × 32 × 8 × 128 × 2 = 131072 B
  assert.equal(json.kvCache.bytesPerToken, 131072);
  // Weights ≈ params × (4.85/8)
  const expectedWeightsGb = (8_030_269_568 * (4.85 / 8)) / 1024 ** 3;
  assert.ok(Math.abs(json.weights.gb - expectedWeightsGb) < 1e-4, 'weights gb');
  assert.ok(Math.abs(json.total.gb - (json.weights.gb + json.kvCache.gbAtContext)) < 1e-6);
  assert.equal(json.contextWindow.withinLimit, true);
  assert.match(json.kvCache.formula, /32 layers/);
});

test('vramGb budget produces fits flag and max context that fits', async () => {
  const { status, json } = await call({
    query: { hfId: 'org/model', context: '65536', vramGb: '24' }
  });
  assert.equal(status, 200);
  assert.equal(json.fits.vramGb, 24);
  assert.equal(json.fits.fits, json.total.gb <= 24);
  assert.ok(Number.isFinite(json.fits.maxContextTokens));
  assert.ok(json.fits.maxContextTokens > 0);
  // Max context must be self-consistent: KV at that context fits the budget.
  const kvAtMax = (json.kvCache.bytesPerToken * json.fits.maxContextTokens) / 1024 ** 3;
  assert.ok(json.weights.gb + kvAtMax <= 24 + 1e-9);
});

test('context overflow beyond max_position_embeddings is flagged', async () => {
  const { status, json } = await call({
    query: { hfId: 'org/model', context: '999999' }
  });
  assert.equal(status, 200);
  assert.equal(json.contextWindow.withinLimit, false);
  assert.equal(json.contextWindow.overflowTokens, 999999 - 131072);
});

test('numTurns projection reports the exact overflow turn', async () => {
  const { status, json } = await call({
    query: { hfId: 'org/model', context: '130000', numTurns: '10', tokensPerTurn: '800', vramGb: '1000' }
  });
  assert.equal(status, 200);
  assert.ok(json.projection);
  assert.equal(json.projection.turns.length, 10);
  // 130000 + 800×(t−1) crosses 131072 at t = 3 (131600 > 131072).
  assert.equal(json.projection.firstContextOverflowTurn, 3);
  assert.equal(json.projection.turns[0].overflow, null);
  assert.equal(json.projection.turns[1].overflow, null);
  assert.equal(json.projection.turns[2].overflow, 'context');
  assert.equal(json.projection.turns[2].totalGb, json.weights.gb + json.projection.turns[2].kvGb);
});

test('missing hfId → 400 with guidance; unknown repo → 404 passthrough', async () => {
  const missing = await call({ query: {} });
  assert.equal(missing.status, 400);
  assert.match(missing.json.error, /hfId/);

  installFetch({ config: null });
  const notFound = await call({ query: { hfId: 'org/does-not-exist-xyz' } });
  assert.equal(notFound.status, 404);
  assert.match(notFound.json.error, /hfId|Hugging Face/i);
});

test('GGUF-only repo falls back to largest file size for weights', async () => {
  installFetch({
    info: {
      siblings: [
        { rfilename: 'model-Q4_K_M-00001-of-00002.gguf', size: 4_000_000_000 },
        { rfilename: 'model-Q4_K_M-00002-of-00002.gguf', size: 1_000_000_000 }
      ]
    }
  });
  const { status, json } = await call({ query: { hfId: 'bartowski/Foo-8B-GGUF', quant: 'q4_k_m' } });
  assert.equal(status, 200);
  assert.equal(json.weights.sourceKind, 'file-size');
  // Multi-part GGUF: shards of the matching quant are combined, not just the
  // largest single part.
  assert.equal(json.weights.gb, round3(5_000_000_000 / 1024 ** 3));
  assert.match(json.weights.source, /2-part/);
  assert.match(json.weights.source, /00001-of-00002\.gguf/);
});

test('POST body works like GET query', async () => {
  const post = await call({
    method: 'POST',
    body: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', context: 8192, quant: 'fp16' }
  });
  const get = await call({
    query: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', context: '8192', quant: 'fp16' }
  });
  assert.equal(post.status, 200);
  assert.deepEqual(post.json.weights, get.json.weights);
  assert.deepEqual(post.json.total, get.json.total);
  assert.equal(post.json.inputs.resolvedQuant, 'fp16');
});

function round3(x) { return Math.round(x * 1e6) / 1e6; }

// ---- GGUF fallback path (no config.json in the repo) ----

// Build a minimal but structurally valid GGUF v3 metadata section.
function buildGgufBuffer(kvs) {
  const enc = new TextEncoder();
  const parts = [];
  const u32 = (v) => { const b = new ArrayBuffer(4); new DataView(b).setUint32(0, v, true); return new Uint8Array(b); };
  const u64 = (v) => { const b = new ArrayBuffer(8); new DataView(b).setBigUint64(0, BigInt(v), true); return new Uint8Array(b); };
  const str = (s) => { const bytes = enc.encode(s); const len = u64(bytes.length); const out = new Uint8Array(len.length + bytes.length); out.set(len); out.set(bytes, len.length); return out; };

  parts.push(enc.encode('GGUF'), u32(3), u64(0), u64(Object.keys(kvs).length));
  for (const [k, v] of Object.entries(kvs)) {
    if (typeof v === 'string') {
      parts.push(str(k), u32(8), str(v));
    } else {
      parts.push(str(k), u32(4), u32(v));
    }
  }
  return Buffer.concat(parts.map(p => Buffer.from(p)));
}

test('GGUF-only repo without config.json resolves architecture from the file header', async () => {
  installFetch({
    config: null,
    info: { siblings: [{ rfilename: 'mmproj-F16.gguf', size: 900_000_000 }, { rfilename: 'Foo-8B-Q8_0.gguf', size: 8_500_000_000 }] }
  });
  // Serve a range request for the gguf file.
  const buf = buildGgufBuffer({
    'general.architecture': 'llama',
    'llama.block_count': 32,
    'llama.embedding_length': 4096,
    'llama.attention.head_count': 32,
    'llama.attention.head_count_kv': 8,
    'llama.context_length': 131072
  });
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/resolve/main/config.json')) return { ok: false, status: 404, json: async () => ({}) };
    if (String(url).includes('/api/models/')) {
      return { ok: true, status: 200, json: async () => ({ siblings: [{ rfilename: 'Foo-8B-Q8_0.gguf', size: 8_500_000_000 }] }) };
    }
    assert.match(String(url), /Foo-8B-Q8_0\.gguf/);
    assert.equal(opts.headers.range, 'bytes=0-262143');
    return {
      ok: true, status: 206,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    };
  };

  const { status, json } = await call({ query: { hfId: 'ggml-org/Foo-8B-GGUF', context: '4096' } });
  assert.equal(status, 200);
  assert.equal(json.model.architecture.numLayers, 32);
  assert.equal(json.model.architecture.hiddenSize, 4096);
  assert.equal(json.model.architecture.numHeads, 32);
  assert.equal(json.model.architecture.kvHeads, 8);
  assert.equal(json.kvCache.bytesPerToken, 2 * 32 * 8 * 128 * 2);
  // Weights come from the gguf file size at repo quantization, not params×bpw.
  assert.equal(json.weights.sourceKind, 'file-size');
  assert.equal(json.weights.gb, round3(8_500_000_000 / 1024 ** 3));
});
