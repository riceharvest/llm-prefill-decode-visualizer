import { test } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/_handlers/compute.js';

// #643 end-to-end through the compute handler: model=kvCache plans a VLM
// workload's KV footprint by folding vision tokens into the cache context.

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

async function call(query) {
  const res = mockRes();
  await handler({ method: 'GET', query }, res);
  assert.ok(res.body, 'handler should write a JSON body');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

test('#643 legacy kvCache call has NO vision block (byte-shape preserved)', async () => {
  const { status, json } = await call({ model: 'kvCache', architecture: 'llama70b', contextLength: '65536' });
  assert.equal(status, 200);
  assert.equal(json.vision, undefined);
  assert.ok(!('visionTokens' in json.inputs));
  assert.equal(json.inputs.contextLength, 65536);
});

test('#643 imgRes+imgN extend the KV context and echo the breakdown', async () => {
  const { status, json } = await call({ model: 'kvCache', architecture: 'llama70b', contextLength: '32768', imgRes: '4k', imgN: '3' });
  assert.equal(status, 200);
  assert.equal(json.vision.visionTokens, 19800);
  assert.equal(json.vision.textContextLength, 32768);
  assert.equal(json.vision.totalKvContextLength, 52568);
  assert.equal(json.vision.resolution, '4k');
  // KV math ran over text + vision tokens
  assert.equal(json.inputs.contextLength, 52568);
  assert.ok(json.formula.includes('52568'));
});

test('#643 explicit visionTokens spelling works and mints a distinct calc id', async () => {
  const base = await call({ model: 'kvCache', contextLength: '32768' });
  const withVision = await call({ model: 'kvCache', contextLength: '32768', visionTokens: '1000' });
  assert.notEqual(base.json.id, withVision.json.id, 'vision inputs must bind into the calc id');
  assert.equal(withVision.json.inputs.contextLength, 33768);
});

test('#643 invalid vision params fail loudly (400 problem, not silent all-text)', async () => {
  const bad = await call({ model: 'kvCache', imgRes: '8k' });
  assert.equal(bad.status, 400);
  const neg = await call({ model: 'kvCache', visionTokens: '-1' });
  assert.equal(neg.status, 400);
});
