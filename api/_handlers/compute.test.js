// Issue #765: enablePrefixCaching must honor the SAME boolean table as the
// UI share-link (src/utils/urlState.js readParamBool): 1/true/yes/on → true,
// 0/false/no/off → false, case-insensitive; unrecognized strings fall back to
// the default with a warnings[] entry instead of silently coercing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody } from './compute.js';

function agentic(params) {
  const { status, body } = computeBody({ model: 'agentic', numTurns: 3, ...params });
  assert.equal(status, 200);
  return body;
}

test('falsy spellings disable prefix caching (case-insensitive)', () => {
  for (const v of ['0', 'false', 'no', 'off', 'False', 'FALSE', 'Off']) {
    const body = agentic({ enablePrefixCaching: v });
    assert.equal(body.inputs.enablePrefixCaching, false, `value: ${v}`);
    // Caching off ⇒ every turn prefills the full cumulative context.
    assert.ok(body.totalWalltimeSeconds > body.turns[0].turnWalltimeSeconds);
    assert.equal(body.warnings.filter(w => w.code === 'unrecognized_boolean').length, 0);
  }
});

test('truthy spellings enable prefix caching (case-insensitive)', () => {
  for (const v of ['1', 'true', 'yes', 'on', 'True', 'YES', 'ON']) {
    const body = agentic({ enablePrefixCaching: v });
    assert.equal(body.inputs.enablePrefixCaching, true, `value: ${v}`);
    assert.equal(body.warnings.filter(w => w.code === 'unrecognized_boolean').length, 0);
  }
});

test('real booleans pass through unchanged', () => {
  assert.equal(agentic({ enablePrefixCaching: false }).inputs.enablePrefixCaching, false);
  assert.equal(agentic({ enablePrefixCaching: true }).inputs.enablePrefixCaching, true);
});

test('omitted param keeps the default (true) without warnings', () => {
  const body = agentic({});
  assert.equal(body.inputs.enablePrefixCaching, true);
  assert.equal(body.warnings.filter(w => w.code === 'unrecognized_boolean').length, 0);
});

test('unrecognized string falls back to default AND emits a warning', () => {
  for (const v of ['banana', 'enabled', '2', '-1']) {
    const body = agentic({ enablePrefixCaching: v });
    assert.equal(body.inputs.enablePrefixCaching, true, `value: ${v}`);
    const w = body.warnings.find(x => x.code === 'unrecognized_boolean');
    assert.ok(w, `warning emitted for ${v}`);
    assert.match(w.message, /enablePrefixCaching|boolean/i);
  }
});

test('dry_run echoes the coerced value and still carries the parse warning', () => {
  const off = computeBody({ model: 'agentic', numTurns: 3, enablePrefixCaching: 'no', dry_run: true }).body;
  assert.equal(off.dry_run, true);
  assert.equal(off.inputs.enablePrefixCaching, false);
  assert.equal((off.warnings || []).filter(w => w.code === 'unrecognized_boolean').length, 0);

  const fallback = computeBody({ model: 'agentic', numTurns: 3, enablePrefixCaching: 'banana', dry_run: true }).body;
  assert.equal(fallback.dry_run, true);
  assert.equal(fallback.inputs.enablePrefixCaching, true);
  assert.ok(fallback.warnings.some(w => w.code === 'unrecognized_boolean'));
});

test('polarity actually changes the math (0 vs 1 diverge)', () => {
  const on = agentic({ numTurns: 6, enablePrefixCaching: '1' });
  const off = agentic({ numTurns: 6, enablePrefixCaching: '0' });
  assert.ok(on.totalWalltimeSeconds < off.totalWalltimeSeconds);
});
