import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LESSONS,
  attemptCount,
  checkAnswer,
  markAttempted,
  isComplete,
  loadProgress,
  saveProgress,
  nextIncompleteLesson
} from './curriculum.js';

// In-memory localStorage stand-in (no globals touched).
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v))
  };
}

test('curriculum covers the six ordered lessons from issue #89', () => {
  assert.deepEqual(
    LESSONS.map(l => l.title),
    [
      'TTFT basics',
      'TPOT',
      'Why prefill ≠ decode',
      'Prefix caching',
      'Speculative decoding',
      'KV memory math'
    ]
  );
});

test('every lesson is well-formed: unique ids, valid correctIndex, demo targeting its backend', () => {
  const ids = new Set();
  for (const l of LESSONS) {
    assert.ok(l.id && !ids.has(l.id), `duplicate/empty id: ${l.id}`);
    ids.add(l.id);
    assert.ok(l.question.length > 0);
    assert.ok(l.options.length >= 3);
    assert.ok(l.correctIndex >= 0 && l.correctIndex < l.options.length, `${l.id}: bad correctIndex`);
    assert.ok(['single', 'agentic', 'kvcache'].includes(l.backendTab), `${l.id}: unknown backend`);
    assert.equal(l.demo.tab, l.backendTab, `${l.id}: demo must open its own backend tab`);
    assert.ok(l.explanation.length > 0 && l.verify.length > 0);
  }
});

test('checkAnswer agrees with correctIndex', () => {
  for (const l of LESSONS) {
    assert.equal(checkAnswer(l.id, l.correctIndex), true, l.id);
    assert.equal(checkAnswer(l.id, (l.correctIndex + 1) % l.options.length), false, l.id);
  }
  assert.equal(checkAnswer('nope', 0), false);
});

test('progress persists via injected storage and survives reload', () => {
  const store = fakeStorage();
  let progress = loadProgress(store);
  assert.equal(isComplete(progress, 'ttft-basics'), false);

  progress = saveProgress({ ...progress, completed: { ...progress.completed, 'ttft-basics': Date.now() } }, store);
  assert.equal(isComplete(progress, 'ttft-basics'), true);

  const reloaded = loadProgress(store);
  assert.equal(isComplete(reloaded, 'ttft-basics'), true);
  assert.equal(isComplete(reloaded, 'kv-memory-math'), false);
});

test('loadProgress tolerates corrupt/missing storage entries', () => {
  assert.deepEqual(loadProgress(fakeStorage()), { completed: {}, attempted: {} });
  assert.deepEqual(loadProgress(fakeStorage({ 'llmpd-curriculum-progress': '{oops' })), { completed: {}, attempted: {} });
  assert.deepEqual(loadProgress(fakeStorage({ 'llmpd-curriculum-progress': '"stray"' })), { completed: {}, attempted: {} });
  // storage throwing (quota/private mode) degrades to session-only
  const throwing = { getItem: () => { throw new Error('nope'); }, setItem: () => { throw new Error('nope'); } };
  assert.deepEqual(loadProgress(throwing), { completed: {}, attempted: {} });
  const p = saveProgress({ completed: { x: 1 }, attempted: {} }, throwing);
  assert.deepEqual(p, { completed: { x: 1 }, attempted: {} });
});

test('nextIncompleteLesson finds the first unfinished slot and returns -1 when done', () => {
  const store = fakeStorage();
  let progress = loadProgress(store);
  assert.equal(nextIncompleteLesson(progress), 0);

  const doneIds = ['ttft-basics', 'tpot'];
  progress = saveProgress(
    { completed: Object.fromEntries(doneIds.map(id => [id, 1])) },
    store
  );
  assert.equal(nextIncompleteLesson(progress), 2);

  const allDone = saveProgress(
    { completed: Object.fromEntries(LESSONS.map(l => [l.id, 1])) },
    store
  );
  assert.equal(nextIncompleteLesson(allDone), -1);
});

// ---- #1022: wrong answers must be recorded, not just successes ----

test('#1022: markAttempted counts every check, wrong answers included', () => {
  const store = fakeStorage();
  let progress = loadProgress(store);

  // Two wrong checks then one correct on the same lesson.
  for (let i = 0; i < 3; i++) {
    progress = markAttempted(progress, 'ttft-basics');
  }
  assert.equal(attemptCount(progress, 'ttft-basics'), 3);
  // Completion is orthogonal — attempts alone never complete a lesson.
  assert.equal(isComplete(progress, 'ttft-basics'), false);

  progress = saveProgress(
    { ...progress, completed: { ...progress.completed, 'ttft-basics': Date.now() } },
    store
  );
  const reloaded = loadProgress(store);
  assert.equal(isComplete(reloaded, 'ttft-basics'), true);
  assert.equal(attemptCount(reloaded, 'ttft-basics'), 3); // survives reload
  assert.equal(attemptCount(reloaded, 'tpot'), 0); // untouched lesson
});

test('#1022: legacy completed-only payloads load with an empty attempted map', () => {
  const legacy = fakeStorage({
    'llmpd-curriculum-progress': JSON.stringify({ completed: { 'tpot': 42 } })
  });
  const p = loadProgress(legacy);
  assert.deepEqual(p.attempted, {});
  assert.equal(isComplete(p, 'tpot'), true);

  // And a fresh attempt on top of the legacy record keeps both fields.
  const next = markAttempted(p, 'kv-memory-math');
  assert.equal(attemptCount(next, 'kv-memory-math'), 1);
  assert.equal(isComplete(next, 'tpot'), true);
});

// ---- #1046: lesson 5's mandated verification step must be performable ----

test('#1046: spec-decoding verify step no longer demands an impossible acceptance value', () => {
  const lesson = LESSONS.find(l => l.id === 'spec-decoding');
  // The simulator clamps acceptance to [0.3, 0.95] (SingleTurnVisualizer),
  // so the old "toward 20%" instruction could never be followed.
  assert.ok(!lesson.verify.includes('20%'), lesson.verify);
  assert.ok(/30%/.test(lesson.verify), lesson.verify);
  assert.ok(!lesson.explanation.includes('vanishes entirely'), lesson.explanation);
});
