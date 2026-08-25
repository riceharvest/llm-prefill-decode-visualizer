// Regression tests for #691: user-controlled hfId must be validated and
// URL-encoded before it is interpolated into outbound huggingface.co URLs.
// fetch is stubbed, so no network access happens.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;
let requestedUrls;

function stubFetch() {
  requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        num_hidden_layers: 2,
        hidden_size: 4,
        num_attention_heads: 2,
        safetensors: { total: 1024 }
      })
    };
  };
}

describe('resolveModel hfId validation/encoding (#691)', () => {
  beforeEach(stubFetch);
  afterEach(() => { globalThis.fetch = realFetch; });

  test('rejects query-string injection payloads with 400 before any fetch', async () => {
    const { resolveModel } = await import('./_hfconfig.js');
    await assert.rejects(
      () => resolveModel('org/model?inject=1#frag'),
      (err) => err.status === 400 && /invalid hfId/i.test(err.message)
    );
    assert.equal(requestedUrls.length, 0, 'no outbound request may be built for an invalid hfId');
  });

  test('rejects spaces and stray slashes in the hfId', async () => {
    const { resolveModel } = await import('./_hfconfig.js');
    for (const bad of ['a/b //c', 'org/mo del', 'org//model', '?x/y']) {
      await assert.rejects(() => resolveModel(bad), (err) => err.status === 400);
    }
    assert.equal(requestedUrls.length, 0);
  });

  test('accepts a normal id and encodes segments in the config.json URL', async () => {
    const { resolveModel } = await import('./_hfconfig.js');
    const data = await resolveModel('meta-llama/Llama-3.1-8B-Instruct');
    assert.equal(data.hfId, 'meta-llama/Llama-3.1-8B-Instruct');
    const configUrl = requestedUrls.find(u => u.includes('/resolve/main/config.json'));
    // Per-segment encoding (same style as the /api/models call): "/" stays a
    // path separator; every other reserved char would be %-encoded — but the
    // regex guard above already rejects ids containing any.
    assert.equal(
      configUrl,
      'https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct/resolve/main/config.json'
    );
    assert.ok(!configUrl.includes('?') || configUrl.endsWith('?blobs=true'));
  });
});
