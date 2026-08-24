// Handler-level tests for GET/POST /api/vram, focused on issue #854:
// fits.maxContextTokens must be capped at the model's own context window
// (max_position_embeddings) instead of contradicting contextWindow.withinLimit
// in the same response. Uses the offline HF_ARCH_TABLE tier — zero network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './vram.js';

function call(query) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const res = {
      statusCode: 0,
      setHeader(k, v) { headers.set(k, v); },
      status(c) { this.statusCode = c; return this; },
      end(chunk) {
        try {
          resolve({
            status: this.statusCode || 200,
            headers,
            body: JSON.parse(typeof chunk === 'string' ? chunk : '{}')
          });
        } catch (err) { reject(err); }
      }
    };
    Promise.resolve(handler({ method: 'GET', query }, res)).catch(reject);
  });
}

const HFID = 'meta-llama/Llama-3.1-8B-Instruct'; // table hit: 131072 ctx window

test('#854: huge-budget maxContextTokens is capped at the model context window', async () => {
  const { status, body } = await call({ hfId: HFID, quant: 'q4_k_m', vramGb: 1_000_000 });
  assert.equal(status, 200);
  assert.equal(body.contextWindow.maxPositionEmbeddings, 131072);
  assert.equal(body.fits.maxContextTokens, 131072);
  assert.ok(body.fits.note.includes('capped'), body.fits.note);
});

test('#854: sub-window budgets stay uncapped (no false capping)', async () => {
  // 8B @ 4.5bpw ≈ 4.2 GiB weights; a 12 GB budget leaves ~7.8 GiB KV ≈ well under 131072 tokens
  const { status, body } = await call({ hfId: HFID, quant: 'q4_k_m', vramGb: 12 });
  assert.equal(status, 200);
  assert.ok(body.fits.maxContextTokens > 0, JSON.stringify(body.fits));
  assert.ok(body.fits.maxContextTokens < 131072);
  assert.equal(body.fits.note.includes('capped'), false, body.fits.note);
});

test('#854: over-window request no longer contradicts its own withinLimit verdict', async () => {
  // Pre-fix repro shape: context above the window while fits reports room for more.
  const { status, body } = await call({ hfId: HFID, quant: 'q4_k_m', context: 262144, vramGb: 500_000 });
  assert.equal(status, 200);
  assert.equal(body.contextWindow.withinLimit, false);
  assert.ok(body.fits.maxContextTokens <= body.contextWindow.maxPositionEmbeddings,
    `fits.maxContextTokens=${body.fits.maxContextTokens} vs window=${body.contextWindow.maxPositionEmbeddings}`);
});
