// Waterfall accessible summary (#421).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { waterfallAriaSummary } from './agenticChartA11y.js';

const TURNS = [
  { turn: 1, isCached: false, prefillTime: 0.5389, decodeTime: 2.381, turnWalltime: 2.92 },
  { turn: 2, isCached: true, prefillTime: 0.2105, decodeTime: 2.381, turnWalltime: 2.5915 }
];

test('summarizes every turn with prefill/decode/total and the loop total', () => {
  const s = waterfallAriaSummary(TURNS, 5.5115);
  assert.match(s, /^Turn-by-turn walltime waterfall:/);
  assert.match(s, /T1 full ingest: prefill 539 ms, decode 2\.38 s, turn total 2\.92 s/);
  assert.match(s, /T2 cached: prefill 211 ms, decode 2\.38 s, turn total 2\.59 s/);
  assert.match(s, /Loop total 5\.51 s/);
  assert.match(s, /per-turn data table/);
});

test('empty breakdown yields a non-empty label instead of an unnamed chart', () => {
  const s = waterfallAriaSummary([], null);
  assert.ok(s.length > 0);
  assert.match(s, /no turns configured/);
});

test('long loops are capped with an explicit "+ N more turns" suffix', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    turn: i + 1,
    isCached: i > 0,
    prefillTime: 0.1,
    decodeTime: 0.2,
    turnWalltime: 0.3
  }));
  const s = waterfallAriaSummary(many, 12);
  assert.ok(!s.includes('T13'));
  assert.match(s, /\+ 28 more turns/);
});

test('non-finite totals render without crashing', () => {
  const s = waterfallAriaSummary([{ turn: 1, isCached: false, prefillTime: NaN, decodeTime: 0, turnWalltime: Infinity }], NaN);
  assert.match(s, /prefill ∞/);
  assert.ok(!s.includes('Loop total'));
});
