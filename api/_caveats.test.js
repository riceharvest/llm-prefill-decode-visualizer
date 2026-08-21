import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datasetCaveats, groupCaveats, runsCaveats, rowCaveats, buildCaveats } from './_caveats.js';

test('dataset caveats always include single-stream and self-reported', () => {
  const c = datasetCaveats();
  const codes = c.map(x => x.code);
  assert.ok(codes.includes('single_stream_only'));
  assert.ok(codes.includes('self_reported_unvalidated'));
  for (const x of c) {
    assert.ok(x.code && x.severity && x.summary && x.detail, 'each caveat is fully shaped');
  }
});

test('groupCaveats computes n=1 share', () => {
  const groups = [
    { key: 'a|l1', runs: 1, engines: ['llama.cpp'] },
    { key: 'b|l8', runs: 3, engines: ['llama.cpp'] },
    { key: 'c|m4', runs: 7, engines: ['mlx'] },
    { key: 'd|4090', runs: 2, engines: ['llama.cpp'] }
  ];
  const c = groupCaveats(groups);
  const n1 = c.find(x => x.code === 'n1_groups');
  assert.equal(n1.pct, 25);
  assert.equal(n1.groupsWithOneRun, 1);
  assert.equal(n1.totalGroups, 4);
});

test('groupCaveats detects mixed engine versions in a group', () => {
  const groups = [
    { key: 'a|llama8b', runs: 5, engines: ['llama.cpp', 'MLX', 'llama.cpp'] },
    { key: 'b|4090', runs: 2, engines: ['llama.cpp'] }
  ];
  const mixed = groupCaveats(groups).find(x => x.code === 'mixed_engines');
  assert.equal(mixed.affectedGroups, 1);
  assert.deepEqual(mixed.examples, ['a|llama8b']);
});

test('groupCaveats returns empty when data is clean or absent', () => {
  const clean = [{ key: 'a|x', runs: 4, engines: ['vllm'] }];
  assert.deepEqual(groupCaveats(clean), []);
  assert.deepEqual(groupCaveats([]), []);
});

test('groupCaveats tolerates missing engines arrays (no false mixed-engine flag)', () => {
  const groups = [{ key: 'a|x', runs: 1 }, { key: 'b|y', runs: 1 }];
  const codes = groupCaveats(groups).map(x => x.code);
  assert.deepEqual(codes, ['n1_groups']);
});

test('runsCaveats adds engine-mix caveat only when multiple engines matched', () => {
  const runs = [
    { engine: 'llama.cpp' }, { engine: 'llama.cpp' }, { engine: null }
  ];
  let codes = runsCaveats(runs).map(x => x.code);
  assert.deepEqual(codes, ['self_reported_unvalidated', 'single_stream_only']);

  runs.push({ engine: 'MLX' });
  codes = runsCaveats(runs).map(x => x.code);
  assert.ok(codes.includes('mixed_engines'));
});

test('rowCaveats flags n=1 and mixed engines per row', () => {
  assert.deepEqual(rowCaveats({ runs: 3, engines: ['vllm'] }), []);
  const row = rowCaveats({ runs: 1, engines: ['a', 'b'] });
  assert.deepEqual(row.map(x => x.code), ['mixed_engines', 'n1_group']);
  assert.deepEqual(rowCaveats(null), []);
});

test('buildCaveats combines dataset + group caveats, sorted by code', () => {
  const groups = [{ key: 'a|x', runs: 1, engines: ['p', 'q'] }];
  const all = buildCaveats([{ engine: 'p' }], groups);
  const codes = all.map(x => x.code);
  assert.deepEqual([...codes].sort(), codes);
  for (const expected of ['n1_groups', 'mixed_engines', 'single_stream_only', 'self_reported_unvalidated']) {
    assert.ok(codes.includes(expected));
  }
});
