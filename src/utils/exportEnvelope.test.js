// Regression tests for #762 — export envelope unification (additive).
// All JSON export artifacts now carry the same canonical spellings:
// schemaVersion + generatorId + exportType, so one shape check recognizes
// every artifact. Legacy fields are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildJsonPayload } from '../../api/_export.js';
import { buildSizingReport } from './sizingReport.js';
import { buildSingleTurnJson, GENERATOR_ID } from './exportJson.js';

test('/api/export dataset envelope carries generatorId + exportType (#762)', () => {
  const payload = buildJsonPayload([], '2026-08-25T00:00:00.000Z');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.generatorId, 'llm-prefill-decode-visualizer');
  assert.equal(payload.exportType, 'dataset-export');
});

test('sizing-report envelope gains canonical schemaVersion/generatorId/exportType alongside legacy fields (#762)', () => {
  const report = buildSizingReport({
    scenario: { modelId: 'qwen3.6-27b', contextTokens: 32768 },
    systemA: { id: 'A', name: 'Rig A', totalWalltimeSeconds: 1.2 }
  });
  // New canonical spellings.
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.generatorId, 'llm-prefill-decode-visualizer');
  assert.equal(report.exportType, 'sizing-report');
  // Legacy spellings preserved for existing consumers.
  assert.equal(report.schema, 'sizing-report');
  assert.equal(report.version, 1);
  assert.equal(report.generator, 'LLM Prefill & Decode Visualizer');
});

test('simulation exports expose the same canonical generatorId as the other artifacts (#762)', () => {
  const parsed = buildSingleTurnJson({
    promptTokens: 2048,
    outputTokens: 512,
    prefillSpeed: 3800,
    decodeSpeed: 105
  });
  assert.equal(parsed.generatorId, GENERATOR_ID);
  assert.equal(parsed.generatorId, 'llm-prefill-decode-visualizer');
});
