import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOKENS_PER_TILE,
  estimateImageTokens,
  estimateImageTiles,
  estimateImagesTokens,
  IMAGE_RESOLUTION_PRESETS
} from './multimodal.js';

test('sub-tile images still cost one full tile of vision tokens', () => {
  assert.equal(estimateImageTiles({ width: 512, height: 512 }), 1);
  assert.equal(estimateImageTokens({ width: 512, height: 512 }), TOKENS_PER_TILE);
});

test('a 1MP image costs exactly one tile (~1.1K tokens)', () => {
  assert.equal(estimateImageTiles({ width: 1024, height: 1024 }), 1);
  assert.equal(estimateImageTokens({ width: 1024, height: 1024 }), TOKENS_PER_TILE);
});

test('larger images round up to whole tiles', () => {
  // 1080p ≈ 1.98MP → 2 tiles
  assert.equal(estimateImageTokens({ width: 1920, height: 1080 }), 2 * TOKENS_PER_TILE);
  // 4K ≈ 8.29MP → capped at MAX_TILES_PER_IMAGE (6)
  assert.ok(estimateImageTokens({ width: 3840, height: 2160 }) <= 6 * TOKENS_PER_TILE);
  assert.equal(estimateImageTokens({ width: 8000, height: 8000 }), 6 * TOKENS_PER_TILE);
});

test('missing or invalid dimensions cost nothing', () => {
  assert.equal(estimateImageTokens({}), 0);
  assert.equal(estimateImageTokens({ width: 0, height: 1080 }), 0);
  assert.equal(estimateImageTokens({ width: -5, height: 100 }), 0);
  assert.equal(estimateImageTokens({ width: NaN, height: NaN }), 0);
});

test('image sets sum across attachments and tolerate junk slots', () => {
  const total = estimateImagesTokens([
    { width: 1024, height: 1024 },
    { width: 1920, height: 1080 },
    null
  ]);
  assert.equal(total, 3 * TOKENS_PER_TILE);
  assert.equal(estimateImagesTokens(), 0);
  assert.equal(estimateImagesTokens('nope'), 0);
});

test('resolution presets are usable as estimator inputs', () => {
  for (const preset of IMAGE_RESOLUTION_PRESETS) {
    const tokens = estimateImageTokens(preset);
    assert.ok(tokens >= TOKENS_PER_TILE, `${preset.id} should cost at least one tile`);
  }
  // Tokens must be monotonic with resolution.
  const byArea = [...IMAGE_RESOLUTION_PRESETS].sort((a, b) => a.width * a.height - b.width * b.height);
  for (let i = 1; i < byArea.length; i++) {
    assert.ok(
      estimateImageTokens(byArea[i]) >= estimateImageTokens(byArea[i - 1]),
      'bigger presets should not cost fewer tokens'
    );
  }
});
