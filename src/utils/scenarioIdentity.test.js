import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveScenario } from './scenarioIdentity.js';

const PRESETS = [
  { id: 'chat', promptTokens: 2048, outputTokens: 512 },
  { id: 'rag', promptTokens: 8192, outputTokens: 1024 },
  // Deliberate token-count collision with chat — the old order-dependent
  // .find() would light whichever came first.
  { id: 'impostor', promptTokens: 2048, outputTokens: 512 }
];

test('#786 applied id wins over order-dependent token-count matching', () => {
  const active = resolveActiveScenario(PRESETS, 'chat', 2048, 512);
  assert.equal(active.id, 'chat');
});

test('#786 falls back to exact token match when no id was applied (legacy links)', () => {
  const active = resolveActiveScenario(PRESETS, null, 8192, 1024);
  assert.equal(active.id, 'rag');
});

test('#786 unknown stored id degrades to the token heuristic, never crashes', () => {
  const active = resolveActiveScenario(PRESETS, 'deleted-preset', 2048, 512);
  assert.ok(['chat', 'impostor'].includes(active.id));
  assert.equal(resolveActiveScenario(PRESETS, 'deleted-preset', 3, 3), null);
});

test('#786 hand-typed counts that match no preset yield null (no chip lit)', () => {
  assert.equal(resolveActiveScenario(PRESETS, null, 777, 42), null);
});
