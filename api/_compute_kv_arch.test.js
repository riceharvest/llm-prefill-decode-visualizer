// Regression tests for #764 — kvCache architecture-id handling on /api/compute.
// Unknown or misspelled architecture ids used to silently fall back to generic
// 70B-class geometry (80 layers) with no warning and no echo of the id.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeBody, normalizeArchKey } from './_handlers/compute.js';

test('normalizeArchKey is case/dash/underscore-insensitive', () => {
  assert.equal(normalizeArchKey('Llama-70B'), 'llama70b');
  assert.equal(normalizeArchKey('Mistral-7B'), 'mistral7b');
  assert.equal(normalizeArchKey('qwen_72b'), 'qwen72b');
  assert.equal(normalizeArchKey('  llama8b '), 'llama8b');
  assert.equal(normalizeArchKey(''), null);
  assert.equal(normalizeArchKey(undefined), null);
});

test('exact architecture id still resolves its preset geometry', () => {
  const { status, body } = computeBody({ model: 'kvCache', architecture: 'mistral7b', contextLength: 32768 });
  assert.equal(status, 200);
  assert.equal(body.inputs.numLayers, 32);
  assert.deepEqual(body.warnings, []);
});

test('HuggingFace-style casing/dashes now resolve instead of falling back (#764)', () => {
  const { status, body } = computeBody({ model: 'kvCache', architecture: 'Mistral-7B', contextLength: 32768 });
  assert.equal(status, 200);
  // Real mistral7b geometry (32 layers), NOT the generic 80-layer fallback
  // that produced a 2.5x overestimate before the fix.
  assert.equal(body.inputs.numLayers, 32);
  assert.equal(body.inputs.kvHeads, 8);
  assert.equal(body.formula.includes('32 layers'), true);
  assert.deepEqual(body.warnings, []);
  assert.equal(body.inputs.requestedArchitecture, 'Mistral-7B');
});

test('truly unknown architecture id keeps the math but warns loudly + echoes the id', () => {
  const { status, body } = computeBody({ model: 'kvCache', contextLength: 32768 });
  assert.equal(status, 200);
  const bad = computeBody({ model: 'kvCache', architecture: 'gpt4-turbo', contextLength: 32768 }).body;
  assert.equal(bad.inputs.numLayers, 80); // generic fallback preserved
  assert.equal(body.warnings.length, 0); // omitted id → no warning
  assert.equal(bad.warnings.length, 1);
  assert.equal(bad.warnings[0].code, 'unknown_architecture_fallback');
  assert.ok(/gpt4-turbo/.test(bad.warnings[0].message));
  assert.ok(/llama70b, llama8b, qwen72b, mistral7b/.test(bad.warnings[0].message));
  assert.equal(bad.inputs.requestedArchitecture, 'gpt4-turbo');
});
