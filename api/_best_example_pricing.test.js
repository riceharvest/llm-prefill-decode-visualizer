// Regression test for #1023: the /api/best x-example used to ship
// pricing.perGpu as an array of {gpu, estimateUsd}, but the live wire always
// returns a flat object {estimateUsd, lowUsd, highUsd} (plus a sibling
// pricing.gpuCount). Example-following parsers crashed on the array shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const chunks = [];
const headers = {};
const res = {
  statusCode: 200,
  setHeader(k, v) { headers[k.toLowerCase()] = v; },
  getHeader(k) { return headers[String(k).toLowerCase()]; },
  end(body) { chunks.push(String(body)); },
};

const { default: specHandler } = await import('./_handlers/spec.js');
specHandler({ method: 'GET', url: '/api/spec' }, res);
const spec = JSON.parse(chunks.join(''));

function findPricingExamples(node, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) findPricingExamples(v, out);
  } else if (node && typeof node === 'object') {
    if (node.pricing && typeof node.pricing === 'object' && !Array.isArray(node.pricing)) {
      out.push(node.pricing);
    }
    for (const v of Object.values(node)) findPricingExamples(v, out);
  }
  return out;
}

test('/api/best x-example pricing.perGpu matches the live flat-object shape (#1023)', () => {
  const bestOp = spec.paths['/api/best']?.get;
  assert.ok(bestOp, '/api/best GET documented in spec');
  const pricings = findPricingExamples(bestOp['x-examples']);
  assert.ok(pricings.length > 0, 'best x-example carries a pricing block');
  for (const pricing of pricings) {
    assert.ok(
      pricing.perGpu !== null && typeof pricing.perGpu === 'object' && !Array.isArray(pricing.perGpu),
      `pricing.perGpu must be a plain object (live wire shape), got ${Array.isArray(pricing.perGpu) ? 'array' : typeof pricing.perGpu}`
    );
    for (const key of ['estimateUsd', 'lowUsd', 'highUsd']) {
      assert.equal(typeof pricing.perGpu[key], 'number', `pricing.perGpu.${key}`);
    }
    assert.ok(!('gpu' in pricing.perGpu), 'live perGpu carries no gpu name');
    assert.equal(typeof pricing.gpuCount, 'number', 'sibling pricing.gpuCount present in example');
  }
});
