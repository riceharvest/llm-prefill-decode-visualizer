// Regression test for agent-farm issue #854:
// /api/vram fits.maxContextTokens used to ignore the model's own context
// window, so one response could report withinLimit:false at 4,096 next to
// maxContextTokens:697,239. The bound is now capped at the model's
// max_position_embeddings (uncapped value kept as uncappedMaxContextTokens).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './_handlers/vram.js';

function runHandler(query) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      end(payload) { this.body = payload || ''; resolve(this); }
    };
    handler({ method: 'GET', query }, res).catch(reject);
  });
}

// Offline tier: llama-3-8b resolves from the built-in table with
// maxContextLength = 8192 — deterministic and network-free.
const HFID = 'meta-llama/Llama-3-8B';

test('#854: maxContextTokens is capped to the model context window', async () => {
  const res = await runHandler({ hfId: HFID, context: '4096', vramGb: '100000' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);

  assert.equal(body.contextWindow.maxPositionEmbeddings, 8192);
  assert.equal(body.contextWindow.requested, 4096);
  assert.equal(body.contextWindow.withinLimit, true);

  // Raw bound for a 100 TB budget would be enormous; must be clamped.
  assert.ok(body.fits.uncappedMaxContextTokens > 8192,
    `expected uncapped bound > 8192, got ${body.fits.uncappedMaxContextTokens}`);
  assert.equal(body.fits.maxContextTokens, 8192);
  assert.equal(body.fits.contextWindowCapped, true);
  assert.match(body.fits.note, /capped to the model's own context window/);
});

test('#854: unclamped when the raw bound is below the context window', async () => {
  // 5 GB budget: ~4.6 GB weights leaves <1 GB KV → raw bound well under 8192.
  const res = await runHandler({ hfId: HFID, context: '1024', vramGb: '5' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.fits.contextWindowCapped, false);
  assert.ok(body.fits.maxContextTokens < 8192,
    `expected raw bound < 8192, got ${body.fits.maxContextTokens}`);
  assert.ok(Number.isFinite(body.fits.maxContextTokens));
  assert.equal(body.fits.uncappedMaxContextTokens, undefined);
});

test('#854: fits block stays null without a vram budget', async () => {
  const res = await runHandler({ hfId: HFID, context: '1024' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.fits, null);
});
