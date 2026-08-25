// SLO checker (issue #64): user-defined latency budgets with pass/fail
// evaluation against simulated TTFT / TPOT / walltime results.
//
// A budget value that is missing, zero, or non-finite disables that metric's
// check — evaluate functions return `null` for it and callers skip the badge.
//
// Margin convention: marginPct = (budget − actual) ÷ budget × 100, so positive
// means headroom left under the budget (green badge) and negative means the
// run overran it (red badge).

import { noteStorageFailure, noteStorageSuccess } from './storageHealth.js';

export const SLO_STORAGE_KEY = 'llmpdv.slo-budgets-v1';

// Defaults roughly match common interactive-chat targets:
// TTFT ≤ 500 ms, TPOT ≤ 50 ms (~20 tok/s reading speed), walltime ≤ 10 s.
export const DEFAULT_SLO_BUDGETS = {
  ttftMs: 500,
  tpotMs: 50,
  walltimeSec: 10
};

function positiveFinite(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Coerce arbitrary parsed input into a { ttftMs, tpotMs, walltimeSec,
 *  loopWalltimeSec } budget object whose entries are positive finite numbers
 *  or null (disabled). `loopWalltimeSec` (#682) caps the WHOLE agentic loop;
 *  when unset it falls back to `walltimeSec` at evaluation time. */
export function sanitizeBudgets(raw) {
  return {
    ttftMs: positiveFinite(raw?.ttftMs),
    tpotMs: positiveFinite(raw?.tpotMs),
    walltimeSec: positiveFinite(raw?.walltimeSec),
    loopWalltimeSec: positiveFinite(raw?.loopWalltimeSec)
  };
}

/** Read persisted budgets from localStorage; corrupt data falls back to defaults. */
export function loadSloBudgets(storage = typeof localStorage !== 'undefined' ? localStorage : undefined) {
  if (!storage) return { ...DEFAULT_SLO_BUDGETS };
  try {
    const raw = storage.getItem(SLO_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SLO_BUDGETS };
    return sanitizeBudgets(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SLO_BUDGETS };
  }
}

/** Persist budgets; storage failures are reported via the shared #779 health
 *  registry (private mode, quota-full) AND returned as false so callers can
 *  surface a visible "won't survive reload" warning instead of silently
 *  reverting to defaults on next load. */
export function saveSloBudgets(budgets, storage = typeof localStorage !== 'undefined' ? localStorage : undefined) {
  if (!storage) {
    noteStorageFailure(SLO_STORAGE_KEY);
    return false;
  }
  try {
    storage.setItem(SLO_STORAGE_KEY, JSON.stringify(sanitizeBudgets(budgets)));
    noteStorageSuccess();
    return true;
  } catch {
    noteStorageFailure(SLO_STORAGE_KEY);
    return false;
  }
}

/**
 * Evaluate one metric against its budget.
 * Returns null when either value or budget is unusable (check disabled).
 * Shape: { value, budget, pass, marginPct } — see margin convention above.
 */
export function evaluateMetric(value, budget) {
  const v = Number(value);
  const b = positiveFinite(budget);
  if (!b || Number.isNaN(v)) return null;
  // An infinite value (e.g. decode speed typed as 0 → ∞ TPOT) blows any budget.
  return {
    value: v,
    budget: b,
    pass: Number.isFinite(v) && v <= b,
    marginPct: (b - v) / b * 100
  };
}

/**
 * Evaluate a simulation result against all three budgets.
 * Inputs are in sim-native units: seconds for ttft/walltime, milliseconds for tpot.
 * Returns { ttft, tpot, walltime } of evaluateMetric results (null = disabled).
 */
export function evaluateSlo({ ttftSec = 0, tpotMs = Infinity, walltimeSec = 0 }, budgets) {
  return {
    ttft: evaluateMetric(Number(ttftSec) * 1000, budgets?.ttftMs),
    tpot: evaluateMetric(tpotMs, budgets?.tpotMs),
    walltime: evaluateMetric(walltimeSec, budgets?.walltimeSec)
  };
}

/**
 * Evaluate an agentic loop turn-by-turn so the UI can name which turn blows
 * the budget. Per turn: TTFT ≈ its prefill time, TPOT ≈ decode time per token,
 * and the turn's own walltime is compared against the walltime budget.
 *
 * #682: the walltime budget applies at TWO scopes. In addition to the per-turn
 * checks, the whole loop's summed walltime is evaluated against
 * `loopWalltimeSec` (falling back to `walltimeSec` while no separate loop
 * budget is set), so a loop whose every turn passes but whose TOTAL overruns
 * the budget is not reported as an all-clear.
 *
 * Returns { turns, failingTurns, worstTurn, loopTotal }:
 *   turns        — one { turn, ttft, tpot, walltime } result triple per turn
 *   failingTurns — turn numbers failing ANY enabled check
 *   worstTurn    — turn number with the most negative margin across its checks
 *   loopTotal    — evaluateMetric result for the whole-loop walltime, or null
 *                  when the loop is empty or the budget is disabled
 */
export function evaluateAgenticSlo(turnBreakdown, budgets) {
  const turns = (turnBreakdown || []).map(item => ({
    turn: item.turn,
    // prefillTime/turnWalltime are seconds; the TTFT budget is milliseconds.
    ttft: evaluateMetric(item.prefillTime * 1000, budgets?.ttftMs),
    tpot: evaluateMetric(
      item.decodeTokens > 0 ? (item.decodeTime / item.decodeTokens) * 1000 : Infinity,
      budgets?.tpotMs
    ),
    walltime: evaluateMetric(item.turnWalltime, budgets?.walltimeSec)
  }));

  const failingTurns = turns
    .filter(t => [t.ttft, t.tpot, t.walltime].some(r => r && !r.pass))
    .map(t => t.turn);

  let worstTurn = null;
  let worstMargin = Infinity;
  for (const t of turns) {
    for (const r of [t.ttft, t.tpot, t.walltime]) {
      if (r && r.marginPct < worstMargin) {
        worstMargin = r.marginPct;
        worstTurn = t.turn;
      }
    }
  }

  // Whole-loop scope (#682): sum of every turn's walltime vs the loop budget.
  const loopBudget = positiveFinite(budgets?.loopWalltimeSec) ?? positiveFinite(budgets?.walltimeSec);
  const loopTotal = turns.length > 0
    ? evaluateMetric(
      (turnBreakdown || []).reduce((acc, item) => acc + (Number(item.turnWalltime) || 0), 0),
      loopBudget
    )
    : null;

  return { turns, failingTurns, worstTurn, loopTotal };
}
