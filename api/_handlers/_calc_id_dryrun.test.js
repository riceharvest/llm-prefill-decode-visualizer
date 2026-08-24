// Regression tests for #1091: the dry_run ↔ real-call calc-id swap guarantee
// must hold for ALL models, including model=cost and model=flagged which rely
// on the raw-params fallback stamp in computeBody(). Also pins the second face
// of the bug: adding dry_run=false must never change the minted id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody } from './compute.js';

const CASES = {
  singleTurn: { promptTokens: 4096, outputTokens: 512 },
  speculative: { baseDecodeSpeed: 105, draftTokens: 4, acceptanceRate: 0.7 },
  batched: { batchSize: 16, decodeSpeed: 105 },
  agentic: { numTurns: 6, enablePrefixCaching: 'true' },
  kvCache: { architecture: 'llama70b', contextLength: 65536 },
  flagged: { prefillSpeed: 2400, decodeSpeed: 65, flags: 'flash-attn,kv-q8' },
  cost: { hardwarePriceUsd: 2000, powerDrawWatts: 450 }
};

function bodyId(params) {
  const { status, body } = computeBody(params);
  assert.equal(status, 200);
  return body.id;
}

test('#1091: every model — a dry_run request echoes the SAME id as the real call', () => {
  for (const [model, params] of Object.entries(CASES)) {
    const real = bodyId({ model, ...params });
    const dry = bodyId({ model, ...params, dry_run: 'true' });
    assert.equal(dry, real, `dry_run id must equal the real-call id for model=${model}`);
    assert.match(real, /^calc_[0-9a-f]{12}$/);
  }
});

test('#1091: cost + flagged — dry_run=false collapses to the bare-call id', () => {
  for (const model of ['cost', 'flagged']) {
    const bare = bodyId({ model, ...CASES[model] });
    const explicitFalse = bodyId({ model, ...CASES[model], dry_run: 'false' });
    const camelFalse = bodyId({ model, ...CASES[model], dryRun: false });
    assert.equal(explicitFalse, bare, `dry_run=false must not mutate the id for model=${model}`);
    assert.equal(camelFalse, bare, `dryRun=false must not mutate the id for model=${model}`);
  }
});

test('#1091: resolved-input models are byte-stable before/after the strip (no behavior change)', () => {
  // withId() overrides the raw stamp for these five; ids must be unchanged by
  // the dry-run-key strip, i.e. equal to a hash over their resolved inputs.
  for (const model of ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache']) {
    const bare = bodyId({ model, ...CASES[model] });
    const withNoiseFlagsStripped = bodyId({ model, ...CASES[model], dry_run: '' });
    assert.equal(withNoiseFlagsStripped, bare, `empty-string dry_run means "default" for model=${model}`);
  }
});
