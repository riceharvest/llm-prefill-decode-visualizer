import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  lmxPresetId,
  runIdFromLmxPreset,
  isDanglingLmxPreset
} from './lmxState.js';

describe('lmxState (#851)', () => {
  test('lmxPresetId/runIdFromLmxPreset round-trip', () => {
    const preset = lmxPresetId('cmri89ntu01b9mj01jxgxxy2o');
    assert.equal(preset, 'lmx:cmri89ntu01b9mj01jxgxxy2o');
    assert.equal(runIdFromLmxPreset(preset), 'cmri89ntu01b9mj01jxgxxy2o');
  });

  test('runIdFromLmxPreset returns null for non-lmx presets', () => {
    assert.equal(runIdFromLmxPreset('rtx4090_exl2'), null);
    assert.equal(runIdFromLmxPreset(''), null);
    assert.equal(runIdFromLmxPreset(undefined), null);
    // Bare 'lmx:' prefix with empty id resolves to an empty (falsy) id.
    assert.equal(runIdFromLmxPreset('lmx:'), '');
  });

  test('dangling detection: cleared run matches the live lmx preset', () => {
    assert.equal(
      isDanglingLmxPreset('lmx:cmri89ntu01b9mj01jxgxxy2o', 'cmri89ntu01b9mj01jxgxxy2o'),
      true
    );
  });

  test('no reset when a different run or a hardware preset is live', () => {
    assert.equal(isDanglingLmxPreset('lmx:other-run-id', 'cmri89ntu01b9mj01jxgxxy2o'), false);
    assert.equal(isDanglingLmxPreset('rtx4090_exl2', 'cmri89ntu01b9mj01jxgxxy2o'), false);
  });

  test('no reset for empty cleared id (initial mount, no selection)', () => {
    assert.equal(isDanglingLmxPreset('lmx:some-run', ''), false);
    assert.equal(isDanglingLmxPreset('lmx:some-run', undefined), false);
  });

  test('regression: wizard clear of the applied run must be detected as dangling', () => {
    // The exact shape from #851: applying run cmri89… then toggling pick order
    // clears the picker selection while App still holds its lmx preset.
    const appliedPreset = lmxPresetId('cmri89ntu01b9mj01jxgxxy2o');
    assert.equal(isDanglingLmxPreset(appliedPreset, 'cmri89ntu01b9mj01jxgxxy2o'), true);
  });
});
