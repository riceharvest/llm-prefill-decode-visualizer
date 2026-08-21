import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  engineTag,
  engineTags,
  mixesEngineVersions,
  matchesEngineQuery,
  mixedEngineWarning
} from './_engine.js';

const run = (engine, version) => ({ engine, engineVersion: version });

test('engineTag combines name and version', () => {
  assert.equal(engineTag(run('llama.cpp', 'b4523')), 'llama.cpp b4523');
  assert.equal(engineTag(run('vLLM', '0.11.0')), 'vLLM 0.11.0');
});

test('engineTag falls back without a version or engine', () => {
  assert.equal(engineTag(run('llama.cpp', null)), 'llama.cpp');
  assert.equal(engineTag(run('llama.cpp', undefined)), 'llama.cpp');
  assert.equal(engineTag(run(null, 'b4000')), 'unknown b4000'); // version still meaningful without a name
  assert.equal(engineTag({}), 'unknown');
});

test('engineTags dedupes while preserving first-seen order', () => {
  const runs = [
    run('llama.cpp', 'b4000'),
    run('vLLM', '0.11.0'),
    run('llama.cpp', 'b4000'),
    run('llama.cpp', 'b4523')
  ];
  assert.deepEqual(engineTags(runs), ['llama.cpp b4000', 'vLLM 0.11.0', 'llama.cpp b4523']);
});

test('mixesEngineVersions flags only genuinely mixed groups', () => {
  assert.equal(mixesEngineVersions([run('llama.cpp', 'b4000'), run('llama.cpp', 'b4000')]), false);
  assert.equal(mixesEngineVersions([run('llama.cpp', 'b4000'), run('llama.cpp', 'b4523')]), true);
  // unversioned runs can't be confirmed as the same build
  assert.equal(mixesEngineVersions([run('llama.cpp', null), run('llama.cpp', 'b4000')]), true);
  assert.equal(mixesEngineVersions([run('llama.cpp', null), run('llama.cpp')]), false);
});

test('matchesEngineQuery is a case-insensitive tag substring match', () => {
  const r = run('llama.cpp', 'B4000');
  assert.equal(matchesEngineQuery(r, 'llama.cpp'), true);
  assert.equal(matchesEngineQuery(r, 'b4000'), true);
  assert.equal(matchesEngineQuery(r, 'B40'), true);
  assert.equal(matchesEngineQuery(r, 'vllm'), false);
  assert.equal(matchesEngineQuery(r, ''), true);
  assert.equal(matchesEngineQuery(r, null), true);
});

test('mixedEngineWarning renders a caution message or null', () => {
  const mixed = [run('llama.cpp', 'b4000'), run('llama.cpp', 'b4523')];
  assert.equal(
    mixedEngineWarning('rtx-4090|llama-3-8b', mixed),
    'rtx-4090|llama-3-8b mixes engine versions (llama.cpp b4000, llama.cpp b4523) — treat delta with caution'
  );
  assert.equal(mixedEngineWarning('same-cohort', [run('llama.cpp', 'b4000')]), null);
});
