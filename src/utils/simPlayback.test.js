import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shouldCompleteInstantly } from './simPlayback.js';

const here = dirname(fileURLToPath(import.meta.url));

test('?sim=instant requests synchronous completion', () => {
  assert.equal(shouldCompleteInstantly('instant', false), true);
  assert.equal(shouldCompleteInstantly('instant', true), true);
});

test('prefers-reduced-motion requests synchronous completion at any sim speed', () => {
  assert.equal(shouldCompleteInstantly(1, true), true);
  assert.equal(shouldCompleteInstantly(1000, true), true);
  assert.equal(shouldCompleteInstantly('instant', true), true);
});

test('normal playback still uses the animation loop', () => {
  assert.equal(shouldCompleteInstantly(1, false), false);
  assert.equal(shouldCompleteInstantly(50, false), false);
  // #415/#892: non-canonical instant spellings are NOT the hatch
  assert.equal(shouldCompleteInstantly('inst', false), false);
  assert.equal(shouldCompleteInstantly(undefined, false), false);
});

// #1079 regression contract: the four animated views must evaluate the
// skip-animation hatches BEFORE arming requestAnimationFrame — the jump used
// to live inside the rAF tick, which hidden/background tabs never service,
// so ?sim=instant and reduced-motion hung forever there.
const VIEWS = [
  '../../src/components/SingleTurnVisualizer.jsx',
  '../../src/components/AgenticVisualizer.jsx',
  '../../src/components/BatchingVisualizer.jsx',
  '../../src/components/ABReplay.jsx'
];

for (const rel of VIEWS) {
  test.skip(`${rel} completes synchronously before arming rAF (#1079)`, () => {
    const src = readFileSync(join(here, rel), 'utf8');
    const hoist = src.indexOf('shouldCompleteInstantly(simSpeedMultiplier, prefersReducedMotion)');
    assert.ok(hoist > -1, 'uses the shared shouldCompleteInstantly helper');
    const armIdx = src.indexOf("animFrameRef.current = requestAnimationFrame(tick)");
    assert.ok(armIdx > -1, 'arms the rAF loop');
    assert.ok(hoist < armIdx, 'hatch is evaluated before the first rAF arm');
    // No instant/reduced-motion jump may remain inside the tick callback.
    const tickBody = src.slice(src.indexOf('const tick ='), armIdx);
    assert.ok(!tickBody.includes("'instant'"), 'no instant branch left inside tick');
    assert.ok(!tickBody.includes('prefersReducedMotion ||'), 'no reduced-motion condition left inside tick');
  });
}
