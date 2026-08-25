// #601 (additive slice) — model=kvCache with an unknown architecture id used
// to silently fall back to generic GQA geometry with a plausible 200 and no
// trace of the substitution. The response now carries an
// architecture_unknown_generic_fallback warning (real + dry_run paths), and
// known ids stay warning-free with unchanged math/calc ids.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody } from '../api/_handlers/compute.js';

test('#601: unknown architecture id emits a generic-fallback warning', () => {
  const out = computeBody({ model: 'kvCache', architecture: 'kimik3', contextLength: 65536 });
  assert.equal(out.status, 200);
  const warnings = out.body.warnings || [];
  const w = warnings.find(x => x.code === 'architecture_unknown_generic_fallback');
  assert.ok(w, 'expected architecture_unknown_generic_fallback warning');
  assert.ok(w.message.includes('kimik3'));
  assert.ok(w.message.includes('GQA'));
});

test('#601: dry_run echoes the same fallback warning', () => {
  const out = computeBody({ model: 'kvCache', architecture: 'nope404', dry_run: true });
  assert.equal(out.body.dry_run, true);
  const w = (out.body.warnings || []).find(x => x.code === 'architecture_unknown_generic_fallback');
  assert.ok(w, 'dry_run should surface the downgrade too');
});

test('#601: known preset ids stay warning-free', () => {
  for (const arch of ['llama70b', 'llama8b', 'qwen72b', 'mistral7b']) {
    const out = computeBody({ model: 'kvCache', architecture: arch });
    assert.deepEqual(out.body.warnings || [], [], `${arch} must not warn`);
  }
});

test('#601: the warning does not perturb determinism — same input, same id', () => {
  const a = computeBody({ model: 'kvCache', architecture: 'kimik3' });
  const b = computeBody({ model: 'kvCache', architecture: 'kimik3' });
  assert.equal(a.body.id, b.body.id);
  assert.equal(typeof a.body.id, 'string');
});
