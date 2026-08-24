import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidateCache } from '../_localmaxxing.js';
import bestHandler from './best.js';

// Regression tests for #1111 (cost-mode power inputs: ?powerDrawWatts=
// alias + per-hwClass watt fallbacks that were dead on uppercase wire
// values) and #780 (fit/maxVramGb exclusion telemetry).

function row(id, { hwClass, vramGb, decode = 100, prefill = 300 } = {}) {
  return {
    id,
    tokSPrefill: prefill,
    tokSOut: decode,
    hardwareGroupKey: `rig-${id}`,
    hardwareGroupLabel: `Rig ${id}`,
    model: { hfId: 'org/Test-7B', displayName: 'Test 7B' },
    engine: { engineName: 'llama.cpp' },
    batchSize: 1,
    hardware: { hwClass, vramGb }
  };
}

async function callBestHandler(query, rows) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows }) });
  invalidateCache();
  try {
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
    await bestHandler({ query }, res);
    return captured;
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCache();
  }
}

test('by=cost uses the per-hwClass default watts even when hwClass arrives uppercased (#1111)', async () => {
  const res = await callBestHandler(
    { by: 'cost' },
    [row('d', { hwClass: 'DISCRETE_GPU', vramGb: 24 }), row('u', { hwClass: 'UNIFIED', vramGb: null, unifiedMemoryGb: 16 })]
  );
  assert.equal(res.status, 200);
  const byKey = new Map(res.body.results.map(r => [r.hardwareKey, r]));
  // discrete_gpu → 300 W, unified → 60 W (not the flat 150 W fallback).
  assert.equal(byKey.get('rig-d').costInputs.powerDrawWatts, 300);
  assert.equal(byKey.get('rig-u').costInputs.powerDrawWatts, 60);
});

test('by=cost honors compute-documented ?powerDrawWatts= and legacy ?powerWatts= (#1111)', async () => {
  const viaAlias = await callBestHandler(
    { by: 'cost', powerDrawWatts: '550' },
    [row('d', { hwClass: 'DISCRETE_GPU', vramGb: 24 })]
  );
  assert.equal(viaAlias.body.results[0].costInputs.powerDrawWatts, 550);

  const viaLegacy = await callBestHandler(
    { by: 'cost', powerWatts: '450' },
    [row('d', { hwClass: 'DISCRETE_GPU', vramGb: 24 })]
  );
  assert.equal(viaLegacy.body.results[0].costInputs.powerDrawWatts, 450);

  // Legacy ?powerWatts= keeps precedence when both are passed (?? order),
  // so existing callers' behavior is unchanged.
  const both = await callBestHandler(
    { by: 'cost', powerWatts: '450', powerDrawWatts: '550' },
    [row('d', { hwClass: 'DISCRETE_GPU', vramGb: 24 })]
  );
  assert.equal(both.body.results[0].costInputs.powerDrawWatts, 450);
});

test('fitCheck exposes the spec-declared excludedRuns counter (#780)', async () => {
  const rows = [
    // This rig cannot hold a 70B model at fp16 / 32k context.
    row('tiny', { hwClass: 'DISCRETE_GPU', vramGb: 8 }),
    // Big rig survives.
    row('huge', { hwClass: 'DISCRETE_GPU', vramGb: 96 })
  ];
  const withFit = await callBestHandler({ by: 'decode', fitCheck: 'true', contextLength: '32768' }, rows);
  assert.equal(withFit.status, 200);
  assert.equal(typeof withFit.body.excludedRuns, 'number');
  assert.ok(withFit.body.excludedRuns >= 1, 'at least the 8 GB rig should be excluded');
  assert.equal(withFit.body.matchedRuns + withFit.body.excludedRuns, rows.length);

  // Absent without fitCheck (spec: "present only with fitCheck").
  const noFit = await callBestHandler({ by: 'decode' }, rows);
  assert.equal('excludedRuns' in noFit.body, false);
});

test('maxVramGb reports unknown-memory exclusions separately (#780)', async () => {
  const rows = [
    row('known-small', { hwClass: 'DISCRETE_GPU', vramGb: 8 }),
    row('known-big', { hwClass: 'DISCRETE_GPU', vramGb: 48 }),
    row('unknown', { hwClass: 'DISCRETE_GPU', vramGb: null })
  ];
  const res = await callBestHandler({ by: 'decode', maxVramGb: '16' }, rows);
  assert.equal(res.status, 200);
  assert.equal(res.body.excludedUnknownVramGb, 1);
  assert.equal(res.body.matchedRuns, 1); // only known-small survives

  // Absent when no maxVramGb filter was given.
  const unfiltered = await callBestHandler({ by: 'decode' }, rows);
  assert.equal('excludedUnknownVramGb' in unfiltered.body, false);
});
