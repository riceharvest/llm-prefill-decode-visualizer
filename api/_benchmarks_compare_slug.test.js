// Issue #757: /api/benchmarks?groupBy=hardware must expose a constructible
// slug per group so agents can build /compare/:slugA-vs-:slugB URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import benchmarksHandler from '../api/_handlers/benchmarks.js';
import { invalidateCache } from '../api/_localmaxxing.js';

function rawRow(overrides = {}) {
  return {
    id: overrides.id ?? 'r1',
    tokSPrefill: 1200,
    tokSOut: 100,
    createdAt: '2026-08-01T00:00:00Z',
    contextLength: 8192,
    promptTokens: 4096,
    outputTokens: 512,
    batchSize: 1,
    hardwareGroupKey: overrides.hardwareGroupKey ?? 'rtx-4090',
    hardwareGroupLabel: overrides.hardwareGroupLabel ?? 'RTX 4090',
    hardware: { hwClass: 'discrete_gpu' },
    model: { hfId: 'org/Test-8B', displayName: 'Test 8B', params: 8 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6000', quantization: 'q4_k_m' },
    ...overrides,
  };
}

async function callHandler(query) {
  const captured = {};
  const res = {
    statusCode: 0,
    setHeader() {},
    getHeader() { return undefined; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(body);
    }
  };
  await benchmarksHandler({ query }, res);
  return captured;
}

test('?groupBy=hardware exposes slug + hardwareLabel matching the compare URL space (#757)', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [
      rawRow(),
      rawRow({
        id: 'r2',
        tokSOut: 80,
        // label with punctuation/parens exercises slugify, not a trivial copy
        hardwareGroupKey: 'cpu_only:intel core ultra 7 155H',
        hardwareGroupLabel: 'Intel(R) Core(TM) Ultra 7 155H',
      }),
    ] })
  });
  invalidateCache();

  const { status, body } = await callHandler({ groupBy: 'hardware', limit: '200' });
  assert.equal(status, 200);

  const bySlug = new Map(body.items.map(g => [g.slug, g]));
  assert.ok(bySlug.has('rtx-4090'), 'expected rtx-4090 in slugs');
  const intel = bySlug.get('intel-r-core-tm-ultra-7-155h');
  assert.ok(intel, `expected intel-r-core-tm-ultra-7-155h in ${[...bySlug.keys()].join(', ')}`);
  assert.equal(intel.hardwareLabel, 'Intel(R) Core(TM) Ultra 7 155H');

  // The response description advertises the recipe to agents.
  assert.match(body.description, /compare\/<slugA>-vs-<slugB>/);
});

test('other groupings do not carry compare-slug fields (they only apply to hardware)', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: [rawRow()] }) });
  invalidateCache();

  const { body } = await callHandler({});
  for (const g of body.items) {
    assert.equal(g.slug, undefined);
    assert.equal(g.hardwareLabel, undefined);
  }
});
