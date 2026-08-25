// Issue #667 — the /api/compute capability catalog must map the web UI's four
// feature toggles to API parameters so flag-curious agents don't land on
// model=flagged (engine launch flags, zero overlap with the UI toggles).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { computeBody } = await import('./_handlers/compute.js');

function catalog() {
  const { status, body } = computeBody({});
  assert.equal(status, 200);
  return body;
}

test('capability catalog carries a uiToggles section (#667)', () => {
  const c = catalog();
  assert.ok(c.uiToggles, 'uiToggles present in GET /api/compute index');
});

test('all four Single-turn toggles are mapped', () => {
  const t = catalog().uiToggles;
  for (const key of ['speculativeDecoding', 'itlJitter', 'contextScaling', 'attachedImages']) {
    assert.ok(t[key], `${key} mapped`);
    assert.equal(t[key].uiToggle && typeof t[key].uiToggle, 'string');
  }
});

test('speculative decoding maps to model=speculative with real params', () => {
  const spec = catalog().uiToggles.speculativeDecoding;
  assert.match(spec.api, /model=speculative/);
  for (const p of ['baseDecodeSpeed', 'draftTokens', 'acceptanceRate']) {
    assert.ok(spec.params.includes(p), `param ${p} declared`);
  }
});

test('toggles without an API equivalent are explicitly null, not misdirected at flagged', () => {
  const t = catalog().uiToggles;
  for (const key of ['itlJitter', 'contextScaling', 'attachedImages']) {
    assert.equal(t[key].api, null, `${key}.api is null`);
    assert.ok(t[key].note.length > 20, `${key} explains why`);
  }
  assert.match(
    String(catalog().models.flagged.description),
    /launch flags/i,
    'flagged description warns it is about launch flags'
  );
});
