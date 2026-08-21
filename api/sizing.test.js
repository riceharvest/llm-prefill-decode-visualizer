import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import handler, { bitsPerWeight } from './sizing.js';
import { kvCache } from './_math.js';
import { invalidateCache } from './_localmaxxing.js';

// Minimal Vercel-style req/res mocks so we can unit-test the handler
// without a server.
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  return res;
}

async function call({ method = 'GET', query = {}, body } = {}) {
  const req = { method, query, body };
  const res = mockRes();
  await handler(req, res);
  assert.ok(res.body, 'handler should write a JSON body');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

// ---- Fake upstream dataset (upstream leaderboard row shape) ----
function row(id, { hfId, params, rig, hwClass, gpu, gpuCount, vramGb, unifiedMemoryGb, quant, engine, prefill, decode }) {
  return {
    id,
    batchSize: 1,
    tokSPrefill: prefill,
    tokSOut: decode,
    model: { hfId, displayName: hfId, params },
    hardwareGroupKey: rig,
    hardwareGroupLabel: rig,
    hardware: { hwClass, gpuName: gpu, gpuCount, vramGb, unifiedMemoryGb },
    engine: { engineName: engine, quantization: quant },
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192
  };
}

const FAKE_ROWS = [
  // Fast discrete GPU, tight VRAM
  row('r1', { hfId: 'Qwen/Qwen3.6-27B-GGUF', params: 27, rig: 'rtx-4090', hwClass: 'discrete_gpu', gpu: 'RTX 4090', gpuCount: 1, vramGb: 24, quant: 'Q4_K_M', engine: 'llama.cpp', prefill: 5000, decode: 120 }),
  row('r2', { hfId: 'unsloth/Qwen3.6-27B-4bit', params: 27, rig: 'rtx-4090', hwClass: 'discrete_gpu', gpu: 'RTX 4090', gpuCount: 1, vramGb: 24, quant: 'Q4_K_M', engine: 'llama.cpp', prefill: 4800, decode: 110 }),
  // Big unified-memory box: slower, but fits huge contexts
  row('r3', { hfId: 'Qwen/Qwen3.6-27B-MLX', params: 27, rig: 'm3-ultra', hwClass: 'unified', gpu: 'M3 Ultra', gpuCount: 1, unifiedMemoryGb: 256, quant: '4bit', engine: 'MLX', prefill: 3000, decode: 60 }),
  // Slow outlier to exercise SLO rejection
  row('r4', { hfId: 'Qwen/Qwen3.6-27B-GGUF', params: 27, rig: 'old-laptop', hwClass: 'cpu_only', gpu: null, gpuCount: 1, vramGb: null, quant: 'Q4_K_M', engine: 'llama.cpp', prefill: 200, decode: 3 })
];

let realFetch;
before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    return {
      ok: true,
      json: async () => ({ rows: offset === 0 ? FAKE_ROWS : [] })
    };
  };
  invalidateCache();
});
after(() => {
  globalThis.fetch = realFetch;
  invalidateCache();
});

test('missing model param is a 400 with a helpful example', async () => {
  const { status, json } = await call({});
  assert.equal(status, 400);
  assert.match(json.error, /model/);
  assert.ok(json.example.includes('/api/sizing'));
});

test('no matching runs is a 404, not an empty 200', async () => {
  const { status, json } = await call({ query: { model: 'nonexistent-model-xyz' } });
  assert.equal(status, 404);
  assert.match(json.error, /No comparable benchmark runs/);
});

test('happy path: ranked recommendations with VRAM fit math and expected TTFT/TPOT', async () => {
  const { status, json } = await call({ query: { model: 'qwen' } });
  assert.equal(status, 200);
  assert.equal(json.matchedRuns, 4);
  assert.ok(json.recommendations.length >= 2);

  const top = json.recommendations[0];
  assert.equal(top.hardwareKey, 'rtx-4090'); // fastest median decode wins

  // VRAM math: 27B @ 4.25 bpw = 14.34 GB weights; KV from the params-bucket arch
  const kv = kvCache({ numLayers: 48, kvHeads: 8, headDim: 128, contextLength: 8192, precisionBytes: 2, batchSize: 1 });
  const weightsGb = 27 * 4.25 / 8;
  assert.equal(top.vramFit.weightsGb, Math.round(weightsGb * 100) / 100);
  assert.equal(top.vramFit.kvCacheGb, kv.totalGb);
  assert.equal(top.vramFit.requiredGb, Math.round((weightsGb + kv.totalGb + 1.5) * 100) / 100);
  assert.equal(top.vramFit.availableGb, 24);
  assert.equal(top.vramFit.fits, true);

  // TTFT/TPOT from medians: prefill median (4800+5000)/2 = 4900, decode 115
  assert.equal(top.expected.ttftSeconds, Math.round((2048 / 4900) * 1e4) / 1e4);
  assert.equal(top.expected.tpotMs, Math.round((1000 / 115) * 100) / 100);
  assert.equal(top.confidence.runsInGroup, 2);
});

test('SLO caps flag recommendations that miss the bar', async () => {
  const { json } = await call({ query: { model: 'qwen', maxTpotMs: 5, maxTtftSeconds: 0.01 } });
  assert.ok(json.recommendations.length > 0);
  for (const rec of json.recommendations) {
    assert.equal(rec.meetsSlo.ttft, false);
    assert.equal(rec.meetsSlo.tpot, false);
    assert.equal(rec.meetsSlo.all, false);
  }

  // A generous SLO flips the flags
  const ok = await call({ query: { model: 'qwen', maxTpotMs: 100, maxTtftSeconds: 2, maxVramGb: 32 } });
  const top = ok.json.recommendations[0];
  assert.equal(top.meetsSlo.all, true);
  // 256GB M3 Ultra is excluded by the budget cap
  assert.ok(ok.json.recommendations.every(r => r.memoryGb <= 32));
});

test('concurrency scales KV cache and decays per-user decode', async () => {
  const single = (await call({ query: { model: 'qwen', limit: 1 } })).json.recommendations[0];
  const quad = (await call({ query: { model: 'qwen', concurrency: 4, limit: 1 } })).json.recommendations[0];

  assert.ok(quad.vramFit.kvCacheGb > single.vramFit.kvCacheGb);
  // decode median 115 → per-user 115 * 4^-0.25 ≈ 81.3
  assert.equal(quad.expected.perUserDecodeTokPerSec, Math.round(115 * Math.pow(4, -0.25) * 10) / 10);
  assert.match(quad.expected.note, /single-stream/);
});

test('POST with a JSON workload spec behaves like GET', async () => {
  const { status, json } = await call({
    method: 'POST',
    body: { model: 'qwen', contextLength: 32768, maxTpotMs: 50 }
  });
  assert.equal(status, 200);
  assert.equal(json.workload.contextLength, 32768);
  const rec = json.recommendations[0];
  const kv = kvCache({ numLayers: 48, kvHeads: 8, headDim: 128, contextLength: 32768, precisionBytes: 2, batchSize: 1 });
  assert.equal(rec.vramFit.kvCacheGb, kv.totalGb);
});

test('unified-memory rigs use unifiedMemoryGb for the fit check', async () => {
  const { json } = await call({ query: { model: 'qwen', hwClass: 'unified', limit: 5 } });
  const rec = json.recommendations.find(r => r.hardwareKey === 'm3-ultra');
  assert.ok(rec, 'm3-ultra should be present');
  assert.equal(rec.memSource, 'unified');
  assert.equal(rec.memoryGb, 256);
  assert.equal(rec.vramFit.fits, true);
});

test('bitsPerWeight parses common quant labels', () => {
  assert.equal(bitsPerWeight('Q4_K_M'), 4.25);
  assert.equal(bitsPerWeight('q8_0'), 8);
  assert.equal(bitsPerWeight('fp16'), 16);
  assert.equal(bitsPerWeight('4bit'), 4.25); // unknown → documented fallback
  assert.equal(bitsPerWeight(undefined), 4.25);
});
