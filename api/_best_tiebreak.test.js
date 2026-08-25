// Regression tests for rank-order determinism on /api/best (#812 #813 #793):
// tied sort keys used to resolve by upstream insertion order, so the same
// calc_ id could replay to a different rank order / top-N membership and the
// cited example model could swap. Every ranking path now ends in a
// deterministic tie-break on stable group identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, invalidateCache } from './_localmaxxing.js';
import bestHandler, { rankGroups } from './_handlers/best.js';

function run(hardwareKey, modelFamily, decode, tag = '') {
  return {
    runId: `${hardwareKey}-${modelFamily}-${decode}${tag}`,
    modelFamily,
    hardwareKey,
    prefillTokPerSec: decode * 3,
    decodeTokPerSec: decode
  };
}

const KEY = r => `${r.hardwareKey}|${r.modelFamily}`;

test('tied-median groups rank identically under any upstream row order', () => {
  const rows = [
    run('rig-a', 'm1', 100),
    run('rig-b', 'm2', 100), // ties rig-a on median decode
    run('rig-c', 'm3', 50)
  ];
  const forward = rankGroups(aggregate(rows, KEY), 'decode', null, 10);
  const backward = rankGroups(aggregate([...rows].reverse(), KEY), 'decode', null, 10);
  assert.deepEqual(
    backward.map(g => g.hardwareKey),
    forward.map(g => g.hardwareKey)
  );
});

test('tied groups are dropped from the top-N deterministically too (#813)', () => {
  const rows = [
    run('rig-b', 'm', 100),
    run('rig-a', 'm', 100),
    run('rig-d', 'm', 100),
    run('rig-c', 'm', 99)
  ];
  const a = rankGroups(aggregate(rows, KEY), 'decode', null, 3);
  const b = rankGroups(aggregate([...rows].reverse(), KEY), 'decode', null, 3);
  assert.deepEqual(b.map(g => g.hardwareKey), a.map(g => g.hardwareKey));
});

test('the cited example run is stable when equal-decode runs swap arrival order (#812)', () => {
  const mk = tagOrder => aggregate(
    tagOrder === 'x-first'
      ? [run('r', 'm', 100, 'x'), run('r', 'm', 100, 'y')]
      : [run('r', 'm', 100, 'y'), run('r', 'm', 100, 'x')],
    KEY
  );
  assert.equal(mk('x-first')[0].bestRun.runId, mk('y-first')[0].bestRun.runId);
});

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

function costRow(key, tokSOut) {
  return {
    id: `c-${key}`,
    tokSPrefill: 3000, tokSOut,
    hardwareGroupKey: key, hardwareGroupLabel: `Rig ${key}`,
    hardware: { hwClass: 'DISCRETE_GPU' },
    model: { hfId: 'org/M-7B', displayName: 'M 7B' },
    engine: { engineName: 'llama.cpp' },
    batchSize: 1
  };
}

test('?by=cost replays to the same order when costs tie exactly (#793)', async () => {
  const rows = [costRow('rig-b', 100), costRow('rig-a', 100)];
  const forward = await callBestHandler({ by: 'cost' }, rows);
  const shuffled = await callBestHandler({ by: 'cost' }, [...rows].reverse());
  assert.equal(forward.status, 200);
  assert.deepEqual(
    shuffled.body.results.map(r => r.hardwareKey),
    forward.body.results.map(r => r.hardwareKey)
  );
});

test('?by=confidence replays to the same order when scores tie (#793)', async () => {
  const rows = [
    costRow('rig-b', 100),
    costRow('rig-a', 100) // n=1 groups with identical stats → identical score
  ];
  const forward = await callBestHandler({ sort_by: 'confidence' }, rows);
  const shuffled = await callBestHandler({ sort_by: 'confidence' }, [...rows].reverse());
  assert.equal(forward.status, 200);
  assert.equal(forward.body.rankedBy, 'confidence');
  assert.deepEqual(
    shuffled.body.results.map(r => r.hardwareKey),
    forward.body.results.map(r => r.hardwareKey)
  );
});
