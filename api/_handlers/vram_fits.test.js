import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './vram.js';

// Offline resolution tier: llama3-8b is in the built-in table
// (_hflookup.js) — 32 layers × 8 kvHeads × 128 headDim, FP16 KV,
// maxContextLength 8192, ~8.03B params. No network needed (#854 regression).

async function call(query) {
  let body;
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { body = payload; }
  };
  await handler({ method: 'GET', query }, res);
  assert.ok(body, 'handler must end the response');
  return { status: res.statusCode, body: JSON.parse(body) };
}

const BASE = { hfId: 'meta-llama/Llama-3-8B', quant: 'q4_k_m', batchSize: 1 };

test('#854: fits.maxContextTokens is capped at the model context window', async () => {
  // A 1000 GB budget admits millions of tokens of KV cache — far beyond
  // llama3-8b's 8192-token window.
  const { status, body } = await call({ ...BASE, context: 4096, vramGb: 1000 });
  assert.equal(status, 200);
  assert.equal(body.contextWindow.maxPositionEmbeddings, 8192);
  assert.equal(body.fits.maxContextTokens, 8192);
  assert.equal(body.fits.contextWindowClamped, true);
  assert.match(body.fits.note, /max_position_embeddings/);
});

test('#854: small budgets keep the unclamped budget-derived value', async () => {
  // Budget barely above weights (~4.3 GiB at q4_k_m) → budget-derived max
  // context well under the 8192-token window.
  const { status, body } = await call({ ...BASE, context: 512, vramGb: 5 });
  assert.equal(status, 200);
  assert.ok(body.fits.maxContextTokens < 8192, `expected unclamped value < 8192, got ${body.fits.maxContextTokens}`);
  assert.equal(body.fits.contextWindowClamped, undefined);
});

test('#854: fits object keeps its existing fields after the clamp logic', async () => {
  const { body } = await call({ ...BASE, context: 4096, vramGb: 1000 });
  for (const key of ['vramGb', 'fits', 'headroomGb', 'maxContextTokens', 'note']) {
    assert.ok(key in body.fits, `fits.${key} must remain present`);
  }
  assert.equal(typeof body.fits.headroomGb, 'number');
});
