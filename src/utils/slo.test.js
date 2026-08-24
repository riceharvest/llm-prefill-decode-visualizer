import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLO_BUDGETS,
  sanitizeBudgets,
  loadSloBudgets,
  saveSloBudgets,
  evaluateMetric,
  evaluateSlo,
  evaluateAgenticSlo,
  formatMs
} from './slo.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    clear: () => map.clear()
  };
}

test('sanitizeBudgets keeps positive finite values and nulls the rest', () => {
  assert.deepEqual(sanitizeBudgets({ ttftMs: 400, tpotMs: '30', walltimeSec: 8 }), {
    ttftMs: 400, tpotMs: 30, walltimeSec: 8
  });
  assert.deepEqual(sanitizeBudgets({ ttftMs: 0, tpotMs: -5, walltimeSec: NaN }), {
    ttftMs: null, tpotMs: null, walltimeSec: null
  });
  assert.deepEqual(sanitizeBudgets(undefined), { ttftMs: null, tpotMs: null, walltimeSec: null });
});

test('load/save round-trips through storage and recovers from corruption', () => {
  const store = fakeStorage();
  assert.deepEqual(loadSloBudgets(store), DEFAULT_SLO_BUDGETS); // nothing stored yet

  assert.equal(saveSloBudgets({ ttftMs: 250, tpotMs: 40, walltimeSec: 3 }, store), true);
  assert.deepEqual(loadSloBudgets(store), { ttftMs: 250, tpotMs: 40, walltimeSec: 3 });

  store.setItem('llmpdv.slo-budgets-v1', '{not json');
  assert.deepEqual(loadSloBudgets(store), DEFAULT_SLO_BUDGETS);
});

test('evaluateMetric returns null for disabled budgets and unknown values', () => {
  assert.equal(evaluateMetric(0.4, null), null);
  assert.equal(evaluateMetric(0.4, 0), null);
  assert.equal(evaluateMetric(NaN, 500), null);
});

test('an infinite value fails any budget (e.g. decode speed typed as 0)', () => {
  const r = evaluateMetric(Infinity, 50);
  assert.equal(r.pass, false);
  assert.equal(r.marginPct, -Infinity);
});

test('evaluateMetric computes pass and signed margin percentage', () => {
  // 300 ms vs 500 ms budget → 40% headroom
  assert.deepEqual(evaluateMetric(300, 500), { value: 300, budget: 500, pass: true, marginPct: 40 });
  // 600 ms vs 500 ms budget → −20% (overrun)
  assert.deepEqual(evaluateMetric(600, 500), { value: 600, budget: 500, pass: false, marginPct: -20 });
  // exactly on budget still passes with zero margin
  assert.equal(evaluateMetric(500, 500).pass, true);
  assert.equal(evaluateMetric(500, 500).marginPct, 0);
});

test('evaluateSlo converts seconds to milliseconds for TTFT and keeps TPOT in ms', () => {
  const r = evaluateSlo({ ttftSec: 0.25, tpotMs: 45, walltimeSec: 6 }, DEFAULT_SLO_BUDGETS);
  assert.equal(r.ttft.pass, true);
  assert.equal(r.ttft.value, 250);
  assert.equal(r.tpot.pass, true);
  assert.equal(r.walltime.pass, true);
  // ∞ TPOT (decode speed 0) fails cleanly instead of throwing
  const bad = evaluateSlo({ ttftSec: 0.1, tpotMs: Infinity, walltimeSec: 2 }, DEFAULT_SLO_BUDGETS);
  assert.equal(bad.tpot.pass, false);
  assert.ok(bad.tpot.marginPct === -Infinity || bad.tpot.marginPct < 0);
});

test('evaluateSlo skips disabled budgets', () => {
  const r = evaluateSlo({ ttftSec: 1, tpotMs: 10, walltimeSec: 99 }, { ttftMs: null, tpotMs: null, walltimeSec: null });
  assert.equal(r.ttft, null);
  assert.equal(r.tpot, null);
  assert.equal(r.walltime, null);
});

function turn(overrides = {}) {
  return {
    turn: 1,
    prefillTime: 0.3,
    decodeTime: 5,
    decodeTokens: 200,
    turnWalltime: 5.3,
    ...overrides
  };
}

test('evaluateAgenticSlo flags which turn blows the budget', () => {
  const breakdown = [
    turn(),                                            // fine everywhere
    turn({ turn: 2, prefillTime: 0.9 }),               // TTFT 900 ms > 500 ms
    turn({ turn: 3, decodeTime: 20, decodeTokens: 200 }) // TPOT 100 ms > 50 ms
  ];
  const r = evaluateAgenticSlo(breakdown, DEFAULT_SLO_BUDGETS);
  assert.equal(r.failingTurns.length, 2);
  assert.deepEqual(r.failingTurns, [2, 3]);
  // Turn 3's TPOT (−100%) is worse than turn 2's TTFT (−80%)
  assert.equal(r.worstTurn, 3);
  // Passing turns carry passing triples
  assert.equal(r.turns[0].ttft.pass, true);
  assert.equal(r.turns[0].tpot.pass, true);
});

test('evaluateAgenticSlo handles empty loops and disabled budgets', () => {
  assert.deepEqual(evaluateAgenticSlo([], DEFAULT_SLO_BUDGETS), { turns: [], failingTurns: [], worstTurn: null });
  const r = evaluateAgenticSlo([turn()], { ttftMs: null, tpotMs: null, walltimeSec: null });
  assert.deepEqual(r.failingTurns, []);
  assert.equal(r.worstTurn, null);
});

test('formatMs renders non-finite values as the infinity glyph, never "Infinity"', () => {
  // evaluateMetric passes value:Infinity through with pass:false when a turn
  // decodes zero tokens (TPOT = Infinity), so the SLO fail-detail string used
  // to print literal "Infinity s" into DOM text and the accessibility tree.
  assert.equal(formatMs(Infinity), '\u221e');
  assert.equal(formatMs(-Infinity), '\u221e');
  assert.equal(formatMs(NaN), '\u221e');
});

test('formatMs keeps one decimal below 1 s and seconds above it', () => {
  // A marginal 9.52 ms TPOT must not round up to "10 ms" against a 9 ms budget.
  assert.equal(formatMs(9.52), '9.5 ms');
  assert.equal(formatMs(540), '540 ms');
  assert.equal(formatMs(5419), '5.42 s');
});
