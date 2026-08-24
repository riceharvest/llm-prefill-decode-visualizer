import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, confidenceFor, invalidateCache } from './_localmaxxing.js';
import bestHandler, { rankGroups } from '../api/_handlers/best.js';

function run(hardwareKey, modelFamily, decode, prefill) {
  return {
    runId: `${hardwareKey}-${modelFamily}-${decode}`,
    modelFamily,
    hardwareKey,
    prefillTokPerSec: prefill ?? decode * 3,
    decodeTokPerSec: decode
  };
}

test('aggregate exposes a 0-100 confidence score next to the medians', () => {
  const groups = aggregate(
    [run('a', 'm', 50), run('a', 'm', 52), run('a', 'm', 48)],
    r => r.hardwareKey
  );
  assert.equal(groups.length, 1);
  const c = groups[0].confidence;
  assert.equal(c.sampleSize, 3);
  assert.ok(Number.isFinite(c.score) && c.score >= 0 && c.score <= 100);
  assert.ok(typeof c.relativeIqr === 'number');
  assert.ok(typeof c.outlierDensity === 'number');
});

test('more samples raise confidence (sample-count factor)', () => {
  const few = confidenceFor([run('a', 'm', 50), run('a', 'm', 51)]);
  const many = confidenceFor(Array.from({ length: 10 }, (_, i) => run('a', 'm', 50 + (i % 2))));
  assert.ok(many.score > few.score);
});

test('wider IQR lowers confidence at equal sample size', () => {
  const tight = confidenceFor([run('a', 'm', 100), run('a', 'm', 101), run('a', 'm', 102), run('a', 'm', 99)]);
  const wide = confidenceFor([run('a', 'm', 100), run('a', 'm', 150), run('a', 'm', 60), run('a', 'm', 105)]);
  assert.ok(wide.score < tight.score);
  assert.ok(wide.relativeIqr > tight.relativeIqr);
});

test('outliers lower confidence via outlier density', () => {
  const clean = confidenceFor(Array.from({ length: 10 }, (_, i) => run('a', 'm', 100 + i)));
  const dirty = confidenceFor([...Array.from({ length: 9 }, (_, i) => run('a', 'm', 100 + i)), run('a', 'm', 500)]);
  assert.ok(dirty.outlierDensity > clean.outlierDensity);
  assert.ok(dirty.score < clean.score);
});

test('confidence is clamped to [0, 100] even for extreme spreads', () => {
  const c = confidenceFor([run('a', 'm', 1), run('a', 'm', 100000)]);
  assert.ok(c.score >= 0 && c.score <= 100);
});

test('n=1 groups get no fabricated spread/outlier stats (#864 #852)', () => {
  const c = confidenceFor([run('a', 'm', 778)]);
  assert.equal(c.sampleSize, 1);
  // was relativeIqr:0 — a single measurement reported as maximally tight
  assert.equal(c.relativeIqr, null);
  // was outlierDensity:1 — the run counted as an outlier of itself
  assert.equal(c.outlierDensity, 0);
  // score = sample factor (0.4 × 1/10) + full spread credit + zero outliers
  assert.equal(c.score, 64);
});

test('n=2+ groups keep real IQR-based stats', () => {
  const c = confidenceFor([...Array.from({ length: 9 }, (_, i) => run('a', 'm', 100 + i)), run('a', 'm', 500)]);
  assert.ok(typeof c.relativeIqr === 'number' && c.relativeIqr > 0);
  assert.ok(c.outlierDensity > 0); // the 500 run sits outside the fences
});

test('rankGroups sorts by confidence when asked', () => {
  const runs = [
    // fast but thin/noisy group
    ...[run('h1', 'fast-model', 200), run('h1', 'fast-model', 20), run('h1', 'fast-model', 400)],
    // slower but dense/clean group
    ...Array.from({ length: 10 }, (_, i) => run('h2', 'slow-model', 80 + (i % 2)))
  ];
  const keyFn = r => r.hardwareKey;
  const byDecode = rankGroups(aggregate(runs, keyFn), 'decode');
  const byConfidence = rankGroups(aggregate(runs, keyFn), 'confidence');

  assert.equal(byDecode[0].modelFamily, 'fast-model'); // raw median still wins on speed
  assert.ok(byConfidence[0].confidence.score > byConfidence[1].confidence.score);
  assert.equal(byConfidence[0].modelFamily, 'slow-model');
  assert.ok(byConfidence.every(r => r.confidence && typeof r.confidence.score === 'number'));
});

async function callBestHandler(query) {
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
}

test('/api/best supports sort_by=confidence end-to-end', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });

  const rows = [
    // fast but noisy/thin rig
    { id: 'r1', tokSPrefill: 600, tokSOut: 200, hardwareGroupKey: 'rig-fast', hardwareGroupLabel: 'Fast Rig',
      model: { hfId: 'org/Fast-7B', displayName: 'Fast 7B' }, engine: { engineName: 'llama.cpp' },
      batchSize: 1 },
    { id: 'r2', tokSPrefill: 90, tokSOut: 15, hardwareGroupKey: 'rig-fast', hardwareGroupLabel: 'Fast Rig',
      model: { hfId: 'org/Fast-7B', displayName: 'Fast 7B' }, engine: { engineName: 'llama.cpp' },
      batchSize: 1 },
    { id: 'r3', tokSPrefill: 1200, tokSOut: 420, hardwareGroupKey: 'rig-fast', hardwareGroupLabel: 'Fast Rig',
      model: { hfId: 'org/Fast-7B', displayName: 'Fast 7B' }, engine: { engineName: 'llama.cpp' },
      batchSize: 1 },
    // slower but dense/clean rig
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`, tokSPrefill: 240, tokSOut: 80 + (i % 2),
      hardwareGroupKey: 'rig-steady', hardwareGroupLabel: 'Steady Rig',
      model: { hfId: 'org/Steady-7B', displayName: 'Steady 7B' }, engine: { engineName: 'llama.cpp' },
      batchSize: 1
    }))
  ];

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows }) // single short page ends pagination
  });
  invalidateCache();

  const byDecode = await callBestHandler({ by: 'decode' });
  assert.equal(byDecode.status, 200);
  assert.equal(byDecode.body.rankedBy, 'decode');
  assert.equal(byDecode.body.results[0].hardwareKey, 'rig-fast');

  const byConfidence = await callBestHandler({ sort_by: 'confidence' });
  assert.equal(byConfidence.status, 200);
  assert.equal(byConfidence.body.rankedBy, 'confidence');
  const scores = byConfidence.body.results.map(r => r.confidence.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.equal(byConfidence.body.results[0].hardwareKey, 'rig-steady');
  assert.ok(byConfidence.body.results.every(r => r.confidence.sampleSize === r.runsInGroup));
});

test('?by=cost honors powerDrawWatts alias and hwClass watt defaults (#1111)', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });

  const row = {
    id: 'c1', tokSPrefill: 3000, tokSOut: 100,
    hardwareGroupKey: 'rig-a', hardwareGroupLabel: 'Rig A',
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 4090', vramGb: 24 },
    model: { hfId: 'org/M-7B', displayName: 'M 7B' },
    engine: { engineName: 'llama.cpp' },
    batchSize: 1
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [row] }) // single short page ends pagination
  });
  invalidateCache();

  // Default: the per-class estimate must survive UPPERCASE wire casing
  // (discrete_gpu → 300 W), not the flat 150 W fallback.
  const def = await callBestHandler({ by: 'cost' });
  assert.equal(def.status, 200);
  assert.equal(def.body.results[0].costInputs.powerDrawWatts, 300);

  // compute's documented ?powerDrawWatts spelling works as an alias…
  const aliased = await callBestHandler({ by: 'cost', powerDrawWatts: '777' });
  assert.equal(aliased.body.results[0].costInputs.powerDrawWatts, 777);
  // …and ?powerWatts keeps working.
  const explicit = await callBestHandler({ by: 'cost', powerWatts: '555' });
  assert.equal(explicit.body.results[0].costInputs.powerDrawWatts, 555);
});
