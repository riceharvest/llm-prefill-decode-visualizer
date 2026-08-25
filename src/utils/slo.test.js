import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLO_BUDGETS,
  sanitizeBudgets,
  loadSloBudgets,
  saveSloBudgets,
  budgetsFromUrlParams,
  budgetUrlParams,
  evaluateMetric,
  evaluateSlo,
  evaluateAgenticSlo
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
  assert.deepEqual(sanitizeBudgets({ ttftMs: 400, tpotMs: '30', walltimeSec: 8, loopWalltimeSec: 60 }), {
    ttftMs: 400, tpotMs: 30, walltimeSec: 8, loopWalltimeSec: 60
  });
  assert.deepEqual(sanitizeBudgets({ ttftMs: 0, tpotMs: -5, walltimeSec: NaN }), {
    ttftMs: null, tpotMs: null, walltimeSec: null, loopWalltimeSec: null
  });
  assert.deepEqual(
    sanitizeBudgets(undefined),
    { ttftMs: null, tpotMs: null, walltimeSec: null, loopWalltimeSec: null }
  );
});

test('load/save round-trips through storage and recovers from corruption', () => {
  const store = fakeStorage();
  assert.deepEqual(loadSloBudgets(store), DEFAULT_SLO_BUDGETS); // nothing stored yet

  assert.equal(saveSloBudgets({ ttftMs: 250, tpotMs: 40, walltimeSec: 3 }, store), true);
  assert.deepEqual(loadSloBudgets(store), { ttftMs: 250, tpotMs: 40, walltimeSec: 3, loopWalltimeSec: null });

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

test('evaluateAgenticSlo evaluates the whole-loop walltime at its own scope (#682)', () => {
  // Issue #682 repro shape: every turn ≈ 2.65 s passes the 10 s per-turn
  // budget, but 20 of them sum to ≈ 53 s — far over the same budget.
  const breakdown = Array.from({ length: 20 }, (_, i) =>
    turn({ turn: i + 1, prefillTime: 0.4, decodeTime: 2.25, decodeTokens: 250, turnWalltime: 2.65 })
  );
  const r = evaluateAgenticSlo(breakdown, DEFAULT_SLO_BUDGETS);
  assert.deepEqual(r.failingTurns, []);           // per-turn scope: green
  assert.ok(Math.abs(r.loopTotal.value - 53) < 1e-9); // loop scope: red
  assert.equal(r.loopTotal.pass, false);
});

test('loopWalltimeSec overrides the fallback for the loop-total scope (#682)', () => {
  const breakdown = [turn({ turnWalltime: 5.3 }), turn({ turn: 2, turnWalltime: 5.3 })];
  // Per-turn: both turns pass the 10 s budget; the 10.6 s loop total passes a
  // generous 30 s loop budget but fails a tight 5 s one.
  const generous = evaluateAgenticSlo(breakdown, { ...DEFAULT_SLO_BUDGETS, loopWalltimeSec: 30 });
  assert.equal(generous.loopTotal.pass, true);
  assert.equal(generous.loopTotal.budget, 30);

  const tight = evaluateAgenticSlo(breakdown, { ...DEFAULT_SLO_BUDGETS, loopWalltimeSec: 5 });
  assert.equal(tight.failingTurns.length, 0);     // turns still green…
  assert.equal(tight.loopTotal.pass, false);      // …but the loop is red
  assert.equal(tight.loopTotal.budget, 5);
});

test('evaluateAgenticSlo handles empty loops and disabled budgets', () => {
  assert.deepEqual(evaluateAgenticSlo([], DEFAULT_SLO_BUDGETS), {
    turns: [], failingTurns: [], worstTurn: null, loopTotal: null
  });
  const r = evaluateAgenticSlo([turn()], { ttftMs: null, tpotMs: null, walltimeSec: null });
  assert.deepEqual(r.failingTurns, []);
  assert.equal(r.worstTurn, null);
  assert.equal(r.loopTotal, null);                // disabled budget → no loop verdict
});

// #407: budgets must be reconstructable from the share link, not just
// whichever browser's localStorage happened to carry them.
test('budgetsFromUrlParams overlays present params on a base (#407)', () => {
  const fromParams = budgetsFromUrlParams(
    k => ({ sloTtft: '100', sloTpot: null, sloWall: undefined }[k] ?? (k === 'sloTtft' ? '100' : null)),
    DEFAULT_SLO_BUDGETS
  );
  assert.equal(fromParams.ttftMs, 100); // URL wins over localStorage base
  assert.equal(fromParams.tpotMs, DEFAULT_SLO_BUDGETS.tpotMs);
  assert.equal(fromParams.walltimeSec, DEFAULT_SLO_BUDGETS.walltimeSec);

  // No params at all → base passes through sanitized.
  const untouched = budgetsFromUrlParams(() => null, { ttftMs: '250', tpotMs: null, walltimeSec: 0 });
  assert.equal(untouched.ttftMs, 250);
  assert.equal(untouched.tpotMs, null);
  assert.equal(untouched.walltimeSec, null);
});

test('invalid URL budget values disable their check instead of falling back silently', () => {
  const r = budgetsFromUrlParams(k => (k === 'sloWall' ? 'garbage' : null), DEFAULT_SLO_BUDGETS);
  assert.equal(r.walltimeSec, null);
  const negative = budgetsFromUrlParams(k => (k === 'sloTpot' ? '-5' : null), DEFAULT_SLO_BUDGETS);
  assert.equal(negative.tpotMs, null);
});

test('budgetUrlParams round-trips and maps disabled budgets to deletable empties (#407)', () => {
  const params = budgetUrlParams({ ttftMs: 100, tpotMs: null, walltimeSec: 2.5 });
  assert.equal(params.sloTtft, '100');
  assert.equal(params.sloTpot, '');
  assert.equal(params.sloWall, '2.5');
  // Round-trip through a URLSearchParams-style getter.
  const p = new URLSearchParams({ sloTtft: params.sloTtft, sloTpot: params.sloTpot, sloWall: params.sloWall });
  const restored = budgetsFromUrlParams(k => p.get(k), {});
  assert.deepEqual(restored, { ttftMs: 100, tpotMs: null, walltimeSec: 2.5 });
});
