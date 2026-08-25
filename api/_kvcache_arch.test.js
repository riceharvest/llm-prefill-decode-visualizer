// Tests for issue #504: /api/compute?model=kvCache used to return HTTP 200
// with Llama-70B geometry for ANY unknown architecture (qwen3627b, dsv4flash,
// bogus, …) — confident wrong numbers with no error or warning. Unknown
// architecture ids must now fail loudly (400 INVALID_PARAMS + available[])
// unless the caller supplies the geometry explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeBody } from './_handlers/compute.js';
import { ApiError } from './_errors.js';

async function kvCache(params) {
  try {
    const out = await computeBody({ model: 'kvCache', ...params });
    return { status: out.status, body: out.body };
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        status: err.status ?? 400,
        body: { code: err.code, detail: err.detail, ...(err.extras || {}) }
      };
    }
    throw err;
  }
}

test('#504: known architectures still compute normally', async () => {
  const { status, body } = await kvCache({ architecture: 'llama70b', contextLength: '65536' });
  assert.equal(status, 200);
  assert.equal(body.inputs.numLayers, 80);
  assert.ok(body.totalGb > 0);
});

test('#504: no architecture at all keeps the documented generic default', async () => {
  const { status, body } = await kvCache({ contextLength: '65536' });
  assert.equal(status, 200);
  assert.equal(body.inputs.numLayers, 80);
});

for (const bogus of ['qwen3627b', 'dsv4flash', 'kimik3', 'bogus']) {
  test(`#504: unknown architecture '${bogus}' is a loud 400, not a silent Llama-70B fallback`, async () => {
    const { status, body } = await kvCache({ architecture: bogus, contextLength: '65536' });
    assert.equal(status, 400);
    assert.equal(body.code, 'INVALID_PARAMS');
    assert.match(body.detail, /Unknown architecture/);
    assert.deepEqual(body.available, ['llama70b', 'llama8b', 'qwen72b', 'mistral7b']);
  });
}

test('#504: dry_run also rejects an unknown architecture (same contract as unknown model)', async () => {
  const { status, body } = await kvCache({ architecture: 'nope', dry_run: 'true' });
  assert.equal(status, 400);
  assert.equal(body.code, 'INVALID_PARAMS');
});

test('#504: unknown label + explicit geometry stays allowed (documented params union)', async () => {
  const { status, body } = await kvCache({
    architecture: 'my-custom-model',
    numLayers: 40,
    kvHeads: 4,
    headDim: 96,
    contextLength: '8192'
  });
  assert.equal(status, 200);
  assert.equal(body.inputs.numLayers, 40);
  assert.equal(body.inputs.kvHeads, 4);
  assert.equal(body.inputs.headDim, 96);
});

test('#504: batch items with an unknown architecture fail per-item without failing the batch', async () => {
  const out = await computeBody({
    batch: [
      { model: 'kvCache', architecture: 'llama70b', contextLength: 65536 },
      { model: 'kvCache', architecture: 'qwen3627b', contextLength: 65536 }
    ]
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.errorCount, 1);
  assert.equal(out.body.okCount, 1);
  assert.equal(out.body.results[1].ok, false);
  assert.match(out.body.results[1].error, /Unknown architecture/);
});
