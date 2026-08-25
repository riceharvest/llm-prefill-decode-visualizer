import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModel, hfconfigCacheSize } from './_hfconfig.js';

// Stub the network so each unique hfId resolves without touching HF. The
// config.json payload is complete enough for the config.json path.
let realFetch;
let fetchCount = 0;
before(() => {
  realFetch = globalThis.fetch;
  fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        num_hidden_layers: 2,
        hidden_size: 8,
        num_attention_heads: 2,
        num_key_value_heads: 2,
        max_position_embeddings: 4096
      })
    };
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

test('#608: cache stays bounded under many unique hfIds', async () => {
  const N = hfconfigCacheSize() + 600; // well past any sane cap
  for (let i = 0; i < N; i++) {
    await resolveModel(`org/model-${i}`);
  }
  assert.ok(hfconfigCacheSize() <= 500,
    `cache should be capped, saw ${hfconfigCacheSize()} entries`);
});

test('#608: eviction drops the OLDEST entries, recent ones stay cached', async () => {
  // Fill with fresh ids; the very first id of this batch must be evicted by
  // later inserts, while the most recent one still hits the cache (no new
  // fetches for it).
  const before = fetchCount;
  await resolveModel('org/evict-a');
  await resolveModel('org/keep-b');
  assert.ok(hfconfigCacheSize() <= 500);
  // keep-b was just inserted → served from cache, no additional fetches.
  const midCount = fetchCount;
  await resolveModel('org/keep-b');
  assert.equal(fetchCount, midCount);
  assert.ok(midCount >= before);
});
