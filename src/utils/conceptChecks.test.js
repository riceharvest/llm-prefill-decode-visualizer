import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONCEPT_CHECKS,
  checksForTab,
  getProgress,
  recordAnswer,
  resetProgress,
  progressForTab
} from './conceptChecks.js';

// Minimal localStorage stub (node:test has no DOM storage).
function installStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    }
  };
  return store;
}

test('catalog defines checks for the sim-bearing tabs only', () => {
  for (const tab of ['single', 'agentic', 'kvcache']) {
    assert.ok(checksForTab(tab).length >= 2, `${tab} should have at least 2 checks`);
  }
  assert.deepEqual(checksForTab('theory'), []);
  assert.deepEqual(checksForTab('nonexistent'), []);
});

test('every check is well-formed with exactly one correct choice', () => {
  for (const [tab, checks] of Object.entries(CONCEPT_CHECKS)) {
    for (const check of checks) {
      assert.ok(check.id && check.question, `${tab}/${check.id} needs id + question`);
      assert.ok(check.choices.length >= 2, `${tab}/${check.id} needs >= 2 choices`);
      assert.equal(check.choices.filter(c => c.correct).length, 1, `${tab}/${check.id} must have exactly one correct choice`);
      assert.equal(typeof check.reveal, 'function', `${tab}/${check.id} reveal must be a function`);
    }
  }
});

test('reveals interpolate live context without throwing', () => {
  const ctx = {
    promptTokens: 8192,
    outputTokens: 512,
    prefillSpeed: 3800,
    decodeSpeed: 105,
    ttft: 8192 / 3800,
    turns: 6,
    cachingOn: true,
    walltime: 12.4,
    noCacheWalltime: 30.1,
    savedPct: 58.8,
    contextLength: 32768,
    bytesPerToken: 320,
    gb: 10.0,
    batch: 1,
    model: 'Llama 70B'
  };
  for (const checks of Object.values(CONCEPT_CHECKS)) {
    for (const check of checks) {
      const text = check.reveal(ctx);
      assert.equal(typeof text, 'string');
      assert.ok(text.length > 40, `${check.id} reveal should be a real explanation`);
      assert.ok(!text.includes('undefined'), `${check.id} reveal must not leak undefined`);
      assert.ok(!text.includes('NaN'), `${check.id} reveal must not leak NaN`);
    }
  }
});

test('progress roundtrips per tab through localStorage', () => {
  installStorage();
  assert.deepEqual(getProgress(), {});
  assert.deepEqual(progressForTab('single'), { answered: 0, correct: 0, total: 2 });

  recordAnswer('single', 'ttft-context-doubling', true);
  recordAnswer('single', 'output-length-ttft', false);
  recordAnswer('agentic', 'prefix-caching-turn1', true);

  assert.deepEqual(progressForTab('single'), { answered: 2, correct: 1, total: 2 });
  assert.deepEqual(progressForTab('agentic'), { answered: 1, correct: 1, total: 2 });

  // Retrying a check overwrites the stored outcome.
  recordAnswer('single', 'output-length-ttft', true);
  assert.deepEqual(progressForTab('single'), { answered: 2, correct: 2, total: 2 });

  resetProgress();
  assert.deepEqual(getProgress(), {});
});

test('storage failures degrade to in-memory behavior, never throw', () => {
  globalThis.window = {
    localStorage: {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); }
    }
  };
  assert.doesNotThrow(() => recordAnswer('single', 'ttft-context-doubling', true));
  assert.deepEqual(getProgress(), {});
  assert.doesNotThrow(() => resetProgress());
});
