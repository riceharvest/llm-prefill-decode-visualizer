// #602 — lmxProvenance(): structured provenance block for exports, non-null
// only when the active preset is an applied lmx:<runId> one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lmxProvenance } from './localMaxxing.js';

const RUN = {
  id: 'cmri89ntu01b9mj01jxgxxy2o',
  createdAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
  tokSPrefill: 10.29, tokSOut: 3.48,
  model: { hfId: 'Qwen/Qwen3.6-27B', displayName: 'Qwen3.6 27B' },
  engine: { engineName: 'llama.cpp', engineVersion: 'b6000', quantization: 'q4_k_m' }
};

test('#602: provenance carries run identity + staleness caveats', () => {
  const p = lmxProvenance('lmx:cmri89ntu01b9mj01jxgxxy2o', RUN);
  assert.equal(p.presetId, 'lmx:cmri89ntu01b9mj01jxgxxy2o');
  assert.equal(p.runId, 'cmri89ntu01b9mj01jxgxxy2o');
  assert.equal(p.modelId, 'Qwen/Qwen3.6-27B');
  assert.equal(p.quantization, 'q4_k_m');
  assert.equal(p.engine, 'llama.cpp');
  assert.equal(p.engineVersion, 'b6000');
  assert.equal(p.kind, 'community-measured');
  assert.equal(p.sourceUrl, 'https://localmaxxing.com/en/runs/cmri89ntu01b9mj01jxgxxy2o');
  assert.equal(p.measuredAt, RUN.createdAt);
  assert.ok(Number.isFinite(p.ageDays) && p.ageDays >= 3);
  assert.ok(p.staleness, 'staleness tier should be set');
});

test('#602: synthetic hardware presets yield null (exports stay unchanged)', () => {
  assert.equal(lmxProvenance('rtx4090_exl2', RUN), null);
  assert.equal(lmxProvenance('', RUN), null);
  assert.equal(lmxProvenance(null, RUN), null);
  // An lmx: label with no resolved run (silent-default case) is also null —
  // provenance must never fabricate measurement claims.
  assert.equal(lmxProvenance('lmx:somerun', null), null);
});
