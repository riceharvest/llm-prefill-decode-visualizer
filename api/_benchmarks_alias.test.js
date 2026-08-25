import { test } from 'node:test';
import assert from 'node:assert/strict';
import benchmarksHandler from '../api/_handlers/benchmarks.js';
import { invalidateCache } from '../api/_localmaxxing.js';

// Issue #874: /api/benchmarks must accept BOTH snake_case and camelCase
// spellings for context_band/max_age/include_outliers/group_by/outlier_iqrs/
// cross_engine — neither spelling may be silently ignored.

function rawRow(overrides = {}) {
  const id = overrides.id ?? 'r1';
  return {
    id,
    tokSPrefill: 1200,
    tokSOut: 100,
    createdAt: '2026-08-01T00:00:00Z',
    contextLength: 8192,
    hardwareGroupKey: 'rtx-4090',
    hardwareGroupLabel: 'RTX 4090',
    model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6000', quantization: 'q4_k_m' },
    batchSize: 1,
    ...overrides
  };
}

function makeRes(captured) {
  return {
    statusCode: 0,
    setHeader() {},
    getHeader() { return undefined; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(body);
    }
  };
}

async function callHandler(query) {
  const captured = {};
  await benchmarksHandler({ query }, makeRes(captured));
  return captured;
}

test('benchmarks param aliases: snake_case and camelCase behave identically', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [rawRow()] }) // single short page ends pagination
  });
  invalidateCache();

  // group_by / groupBy both regroup by model family.
  for (const [k, v] of [['group_by', 'model'], ['groupBy', 'model']]) {
    const { status, body } = await callHandler({ [k]: v, limit: '1' });
    assert.equal(status, 200, k);
    assert.equal(body.items[0].key, 'test-8b', `${k} should regroup by model family`);
    assert.equal(body.engineCohortedByDefault, false, k);
  }

  // outlier_iqrs / outlierIqrs both set the threshold.
  for (const [k, v] of [['outlier_iqrs', '1'], ['outlierIqrs', '1']]) {
    const { status, body } = await callHandler({ [k]: v });
    assert.equal(status, 200, k);
    assert.equal(body.outlierPolicy.thresholdIqrs, 1, k);
  }

  // cross_engine / crossEngine both merge across engine builds.
  for (const [k, v] of [['cross_engine', 'true'], ['crossEngine', 'true']]) {
    const { status, body } = await callHandler({ [k]: v, limit: '1' });
    assert.equal(status, 200, k);
    assert.equal(body.engineCohortedByDefault, false, k);
  }

  // include_outliers / includeOutliers both include outliers in stats.
  for (const [k, v] of [['include_outliers', 'true'], ['includeOutliers', 'true']]) {
    const { status, body } = await callHandler({ [k]: v });
    assert.equal(status, 200, k);
    assert.equal(body.outlierPolicy.includeOutliers, true, k);
  }
});

test('benchmarks param aliases: defaults unchanged when no params given', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [rawRow()] })
  });
  invalidateCache();

  const { status, body } = await callHandler({});
  assert.equal(status, 200);
  assert.equal(body.engineCohortedByDefault, true);
  assert.equal(body.outlierPolicy.thresholdIqrs, 2.5);
  assert.equal(body.outlierPolicy.includeOutliers, false);
});
