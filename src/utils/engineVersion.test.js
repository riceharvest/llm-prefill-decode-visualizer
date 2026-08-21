import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineBuild, cohortKey, engineCohorts, compareWarning, tagCohorts, engineTags } from './engineVersion.js';

const run = (over = {}) => ({
  notes: null,
  engineFlags: {},
  ...over
});

test('prefers structured engineVersion', () => {
  assert.equal(
    engineBuild(run({ engine: { engineName: 'llama.cpp', engineVersion: 'b9947-14-gef8291cc2' } })),
    'llama.cpp b9947-14-gef8291cc2'
  );
  assert.equal(
    engineBuild(run({ engine: { engineName: 'vllm', engineVersion: '0.20.2+rocm723' } })),
    'vllm 0.20.2+rocm723'
  );
});

test('extracts llama.cpp build number from command snippet path', () => {
  const r = run({
    engine: { engineName: 'llama.cpp', engineVersion: null },
    notes: null,
    engineFlags: { commandSnippet: 'E:\\llama.cpp-b10470\\llama-bench.exe -m model.gguf -ngl 0' }
  });
  assert.equal(engineBuild(r), 'llama.cpp b10470');
});

test('extracts build from notes text', () => {
  const r = run({
    engine: { engineName: 'llama.cpp', engineVersion: null },
    notes: 'CPU-only on a Ryzen 7 9800X3D: llama-bench b10470, -t 3, 512p/64n'
  });
  assert.equal(engineBuild(r), 'llama.cpp b10470');
});

test('marks placeholder versions as unknown-build', () => {
  const r = run({ engine: { engineName: 'vllm', engineVersion: 'see Agentic Arcade source metadata' } });
  assert.equal(engineBuild(r), 'vllm unknown-build');
});

test('handles missing engine entirely', () => {
  assert.equal(engineBuild(run()), null);
  assert.equal(cohortKey(run()), 'unknown-engine');
});

test('cohortKey groups identical builds together', () => {
  const a = cohortKey(run({ engine: { engineName: 'llama.cpp', engineVersion: 'b4000' } }));
  const b = cohortKey(run({
    engine: { engineName: 'llama.cpp', engineVersion: null },
    notes: 'built from b4000 release'
  }));
  assert.equal(a, b); // same resolved build cohorts together regardless of source
  // Different builds never cohort together:
  const c = cohortKey(run({ engine: { engineName: 'llama.cpp', engineVersion: 'b4523' } }));
  assert.notEqual(a, c);
});

test('engineCohorts counts and flags mixes', () => {
  const runs = [
    run({ engine: { engineName: 'llama.cpp', engineVersion: 'b4000' } }),
    run({ engine: { engineName: 'llama.cpp', engineVersion: 'b4523' } }),
    run({ engine: { engineName: 'llama.cpp', engineVersion: 'b4523' } })
  ];
  const c = engineCohorts(runs);
  assert.equal(c.mixed, true);
  assert.deepEqual(c.cohorts.map(x => x.tag).sort(), ['llama.cpp b4000', 'llama.cpp b4523']);
  assert.equal(c.cohorts[0].tag, 'llama.cpp b4523'); // sorted by count desc
  assert.equal(c.cohorts[0].runs, 2);
});

test('engineCohorts single cohort is not mixed', () => {
  const runs = [run({ engine: { engineName: 'hipfire', engineVersion: '0.3.0+b0bcc3f91506' } })];
  const c = engineCohorts(runs);
  assert.equal(c.mixed, false);
  assert.equal(c.tags.length, 1);
});

test('compareWarning fires only on mixed cohorts with issue wording', () => {
  assert.equal(
    compareWarning('llama.cpp b4000', 'llama.cpp b4523'),
    'comparing llama.cpp b4000 vs llama.cpp b4523 — treat delta with caution'
  );
  assert.equal(compareWarning('llama.cpp b4000', 'llama.cpp b4000'), null);
  assert.equal(compareWarning(null, 'llama.cpp b4523'), null);
});

test('tagCohorts summarizes flattened runs by engineTag', () => {
  const runs = [
    { engineTag: 'llama.cpp b4523' },
    { engineTag: 'llama.cpp b4523' },
    { engineTag: 'llama.cpp b4000' },
    { engine: 'vllm' } // missing tag falls back to bare engine name
  ];
  const c = tagCohorts(runs);
  assert.equal(c.mixed, true);
  assert.deepEqual(c.tags, ['llama.cpp b4523', 'llama.cpp b4000', 'vllm']);
  assert.deepEqual(c.cohorts[0], { tag: 'llama.cpp b4523', runs: 2 });
});

test('tagCohorts single cohort is not mixed', () => {
  const c = tagCohorts([{ engineTag: 'hipfire 0.3.0+b0bcc3f91506' }, { engineTag: 'hipfire 0.3.0+b0bcc3f91506' }]);
  assert.equal(c.mixed, false);
  assert.equal(c.tags.length, 1);
});

test('engineTags dedupes and falls back to bare engine name', () => {
  assert.deepEqual(
    engineTags([{ engineTag: 'a b1' }, { engineTag: 'a b1' }, { engine: 'vllm' }]),
    ['a b1', 'vllm']
  );
});
