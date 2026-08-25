// Shared boolean/enum param parsing (#688 #704 #713 #728).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseBool, boolWarnings, requireEnum, BOOL_WORDS } = await import('./_params.js');
const { ApiError } = await import('./_errors.js');
const { isDryRun } = await import('./_handlers/compute.js');

test('parseBool accepts 1/true/yes/on case-insensitively (one vocabulary everywhere)', () => {
  for (const v of [1, '1', 'true', 'TRUE', 'Yes', 'ON', ' on ', true]) {
    assert.equal(parseBool(v), true, String(v));
  }
  for (const v of [0, '0', 'false', 'FALSE', 'No', 'OFF', 'off', false]) {
    assert.equal(parseBool(v), false, String(v));
  }
});

test('parseBool returns null for absent and unrecognized values', () => {
  assert.equal(parseBool(undefined), null);
  assert.equal(parseBool(null), null);
  assert.equal(parseBool(''), null);
  assert.equal(parseBool('yeah'), null);
  assert.equal(parseBool('2'), null);
});

test(`BOOL_WORDS documents the accepted set (${BOOL_WORDS})`, () => {
  assert.match(BOOL_WORDS, /1\/true\/yes\/on/);
  assert.match(BOOL_WORDS, /0\/false\/no\/off/);
});

test('isDryRun accepts the shared vocabulary and fail-CLOSES on unknown values (#704)', () => {
  assert.equal(isDryRun({ dry_run: 'true' }), true);
  assert.equal(isDryRun({ dry_run: 'yes' }), true);   // used to silently EXECUTE
  assert.equal(isDryRun({ dryRun: 'YES' }), true);
  assert.equal(isDryRun({ dry_run: 1 }), true);
  assert.equal(isDryRun({ dry_run: false }), false);
  assert.equal(isDryRun({}), false);

  // Unknown value must be a hard 400 INVALID_PARAMS — never a silent run.
  assert.throws(() => isDryRun({ dry_run: 'yeah' }), err => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, 'INVALID_PARAMS');
    return true;
  });
});

test('isDryRun trims and lowercases before judging (#704)', () => {
  assert.equal(isDryRun({ dry_run: 'True' }), true);
  assert.throws(() => isDryRun({ dry_run: 'nope' }), () => true);
});

test('requireEnum: unknown values throw 400, absent falls back, case/space tolerated (#728)', () => {
  assert.equal(requireEnum('json', ['json', 'csv'], 'format', 'csv'), 'json');
  assert.equal(requireEnum('JSON', ['json', 'csv'], 'format', 'csv'), 'json');
  assert.equal(requireEnum(' json ', ['json', 'csv'], 'format', 'csv'), 'json');
  assert.equal(requireEnum(undefined, ['json', 'csv'], 'format', 'csv'), 'csv');
  assert.equal(requireEnum('', ['json', 'csv'], 'format', 'csv'), 'csv');

  assert.throws(
    () => requireEnum('xml', ['json', 'csv'], 'format', 'csv'),
    err => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, 'INVALID_PARAMS');
      assert.match(err.message, /format must be one of "json"\|"csv", got "xml"/);
      return true;
    }
  );
});

test('boolWarnings flags only present-but-unrecognized values (#688)', () => {
  const w = boolWarnings([['crossEngine', 'YES'], ['include_outliers', 'maybe'], ['fitCheck', undefined]]);
  assert.deepEqual(w, ["include_outliers='maybe' is not a recognized boolean (accepted: " + BOOL_WORDS + ') — treated as absent']);
});
