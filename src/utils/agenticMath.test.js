import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { calculateAgenticTimeline, waterfallGeometry } from './agenticMath.js';

test('cached turns prefill only newly appended tool output', () => {
  const turns = calculateAgenticTimeline({
    numTurns: 2,
    basePromptTokens: 100,
    toolOutputTokensPerTurn: 50,
    decodeTokensPerTurn: 100,
    prefillSpeed: 100,
    decodeSpeed: 50,
    enablePrefixCaching: true
  });

  assert.deepEqual(
    turns.map((turn) => ({
      newTokensPrefilled: turn.newTokensPrefilled,
      prefillTime: turn.prefillTime,
      turnWalltime: turn.turnWalltime,
      cumulativeWalltime: turn.cumulativeWalltime
    })),
    [
      { newTokensPrefilled: 100, prefillTime: 1, turnWalltime: 3, cumulativeWalltime: 3 },
      { newTokensPrefilled: 50, prefillTime: 0.5, turnWalltime: 2.5, cumulativeWalltime: 5.5 }
    ]
  );
});

test('waterfall geometry positions each turn after the previous turn', () => {
  const geometry = waterfallGeometry([
    { prefillTime: 1, turnWalltime: 3, cumulativeWalltime: 3 },
    { prefillTime: 0.5, turnWalltime: 2.5, cumulativeWalltime: 5.5 }
  ]);

  assert.equal(geometry[0].leftPercent, 0);
  assert.ok(Math.abs(geometry[0].widthPercent - (300 / 5.5)) < 1e-12);
  assert.ok(Math.abs(geometry[0].prefillPercent - (100 / 3)) < 1e-12);
  assert.ok(Math.abs(geometry[1].leftPercent - (300 / 5.5)) < 1e-12);
  assert.ok(Math.abs(geometry[1].widthPercent - (250 / 5.5)) < 1e-12);
  assert.equal(geometry[1].prefillPercent, 20);
});

test('live progress bars do not restart CSS width transitions every animation frame', async () => {
  const source = await readFile(new URL('../components/AgenticVisualizer.jsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /transition:\s*'width 0\.1s linear'/);
});
