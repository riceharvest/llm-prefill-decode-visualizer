import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveVisionInputs } from './_vision.js';

// #643 — the ~1,100 tok/tile vision estimator becomes API-reachable.

test('no vision params → null (legacy all-text behavior untouched)', () => {
  assert.equal(resolveVisionInputs({}), null);
  assert.equal(resolveVisionInputs({ contextLength: 32768 }), null);
});

test('explicit ?visionTokens= resolves and binds', () => {
  const v = resolveVisionInputs({ visionTokens: '19800' });
  assert.equal(v.visionTokens, 19800);
  assert.equal(v.source, 'explicit');
});

test('?imgRes=4k&imgN=3 → 6 tiles × 1100 × 3 images = 19,800 tokens', () => {
  const v = resolveVisionInputs({ imgRes: '4k', imgN: '3' });
  assert.equal(v.source, 'images');
  assert.equal(v.imageCount, 3);
  assert.equal(v.resolution, '4k');
  assert.equal(v.width, 3840);
  assert.equal(v.height, 2160);
  assert.equal(v.tokensPerImage, 6600); // ceil(3840×2160/1MP)=9 → capped at 6 tiles × 1100
  assert.equal(v.visionTokens, 19800);  // matches the issue's worked example
});

test('imgRes defaults to 1080p when only imgN is given', () => {
  const v = resolveVisionInputs({ imgN: '2' });
  assert.equal(v.resolution, '1080p');
  // 1920×720... 1920×1080 = 2.07MP → ceil = 3 tiles? No: 2073600/1048576 ≈ 1.98 → 2 tiles
  assert.equal(v.tokensPerImage, 2200);
  assert.equal(v.visionTokens, 4400);
});

test('invalid values fail loudly with INVALID_PARAMS + available[]', () => {
  assert.throws(() => resolveVisionInputs({ visionTokens: '-5' }), /positive integer/);
  assert.throws(() => resolveVisionInputs({ imgN: '0' }), /positive integer/);
  try {
    resolveVisionInputs({ imgRes: '8k' });
    assert.fail('unknown preset must throw');
  } catch (err) {
    assert.equal(err.code, 'INVALID_PARAMS');
    assert.deepEqual(err.extras.available, ['720p', '1080p', '1440p', '4k']);
  }
});
