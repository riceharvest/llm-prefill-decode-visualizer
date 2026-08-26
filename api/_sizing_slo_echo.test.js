// Regression tests for issue #1052: /api/sizing must echo slo.maxVramGb
// when supplied (the spec x-example promises it; it was always absent).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlo } from './_handlers/sizing.js';

test('#1052 maxVramGb is echoed when supplied', () => {
  const { slo } = buildSlo({ maxTtftSeconds: '2', maxTpotMs: '50', maxVramGb: '48' });
  assert.deepEqual(slo, { maxTtftSeconds: 2, maxTpotMs: 50, maxVramGb: 48 });
});

test('#1052 maxVramGb stays absent when not supplied (byte-stable payloads)', () => {
  const { slo } = buildSlo({ maxTtftSeconds: '2', maxTpotMs: '50' });
  assert.deepEqual(slo, { maxTtftSeconds: 2, maxTpotMs: 50 });
  assert.ok(!('maxVramGb' in slo));
  assert.deepEqual(buildSlo({}).slo, { maxTtftSeconds: null, maxTpotMs: null });
});

test('#1052 non-finite maxVramGb is not echoed', () => {
  for (const bad of ['abc', 'NaN']) {
    const { slo } = buildSlo({ maxVramGb: bad });
    assert.ok(!('maxVramGb' in slo), `expected no echo for ${JSON.stringify(bad)}`);
  }
});

test('#1052 empty string parses as 0 — echo mirrors the pre-existing filter behavior', () => {
  // Number('') === 0 already fed the VRAM filter before this change; the
  // echo must show what actually ran, so 0 is echoed rather than hidden.
  const { slo, maxVramGb } = buildSlo({ maxVramGb: '' });
  assert.equal(slo.maxVramGb, 0);
  assert.equal(maxVramGb, 0);
});
