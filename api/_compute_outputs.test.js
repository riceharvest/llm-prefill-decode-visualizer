// #489 — the /api/compute capability index documents each model's INPUT
// params but used to say nothing about OUTPUTS, even though metric coverage
// differs per model (speculative returns no time metrics at all). This pins:
//  1. every model entry carries an `outputs` array with field+unit;
//  2. the documented output fields exactly cover the model's actual response
//     fields (no drift in either direction), modulo the envelope fields every
//     model carries and the agentic turns[] pseudo-entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody, MODEL_OUTPUTS } from './_handlers/compute.js';

const EXAMPLES = {
  singleTurn: { model: 'singleTurn', promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 },
  speculative: { model: 'speculative', baseDecodeSpeed: 105, draftTokens: 4, acceptanceRate: 0.7 },
  batched: { model: 'batched', batchSize: 16, decodeSpeed: 105 },
  agentic: { model: 'agentic', numTurns: 6, enablePrefixCaching: true },
  kvCache: { model: 'kvCache', architecture: 'llama70b', contextLength: 65536 },
  flagged: { model: 'flagged', prefillSpeed: 2400, decodeSpeed: 65, flags: 'flash-attn,kv-q8' },
  cost: { model: 'cost', hardwarePriceUsd: 2000, electricityRatePerKwh: 0.15, powerDrawWatts: 450, prefillSpeed: 3800, decodeSpeed: 105 }
};

// Envelope fields present on every successful result, documented once.
const ENVELOPE = new Set(['id', 'inputs', 'warnings']);
// Pseudo-entries that name nested structures instead of a top-level key.
const PSEUDO = new Set(['turns[]']);

test('every model entry in the capability list documents outputs with units', async () => {
  const { status, body } = await computeBody({});
  assert.equal(status, 200);
  for (const [model, entry] of Object.entries(body.models)) {
    assert.ok(Array.isArray(entry.outputs) && entry.outputs.length > 0, `${model}: missing outputs[]`);
    for (const o of entry.outputs) {
      assert.ok(o.field && typeof o.field === 'string', `${model}: output without field name`);
      assert.ok(o.unit && typeof o.unit === 'string', `${model}.${o.field}: output without unit`);
    }
    assert.equal(entry.outputs.length, MODEL_OUTPUTS[model].length);
  }
});

for (const [model, params] of Object.entries(EXAMPLES)) {
  test(`outputs[] matches actual ${model} response fields`, async () => {
    const { status, body } = await computeBody(params);
    assert.equal(status, 200);

    const actual = new Set(Object.keys(body).filter(k => !ENVELOPE.has(k)));
    const documented = new Set();
    for (const o of MODEL_OUTPUTS[model]) {
      if (PSEUDO.has(o.field)) continue;
      documented.add(o.field);
      assert.ok(actual.has(o.field), `${model}: documented output '${o.field}' absent from response`);
    }
    // No undocumented top-level metric fields either (nested arrays covered
    // by a pseudo-entry like turns[] are exempt).
    const pseudoRoots = [...MODEL_OUTPUTS[model]]
      .filter(o => PSEUDO.has(o.field))
      .map(o => o.field.replace('[]', ''));
    for (const k of actual) {
      if (pseudoRoots.some(root => k === root)) continue;
      assert.ok(documented.has(k), `${model}: response field '${k}' is not documented in outputs[]`);
    }
    // The agentic pseudo-entry covers the per-turn array when present.
    if (model === 'agentic') {
      assert.ok(Array.isArray(body.turns) && body.turns.length > 0);
    }
  });
}

test('speculative explicitly documents that it returns no time metrics (#489 core complaint)', async () => {
  const fields = MODEL_OUTPUTS.speculative.map(o => o.field);
  assert.ok(!fields.includes('ttftSeconds'));
  assert.ok(!fields.includes('tpotMs'));
  assert.ok(!fields.includes('totalWalltimeSeconds'));
});
