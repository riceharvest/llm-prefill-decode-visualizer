import { formatTime, formatTokens } from './presets.js';

// Concept-check quizzes (issue: "Include interactive concept-check quizzes").
// Prediction-then-reveal: each prompt asks the user to guess an outcome BEFORE
// revealing the simulated answer with an explanation computed from the LIVE
// simulation state (ctx), so the numbers shown are always this session's.
// Progress is tracked per tab in localStorage so returning users see which
// checks they already answered and how many they got right.

/**
 * Quiz catalog keyed by tab id. `reveal(ctx)` renders the explanation from
 * live simulation values — it must stay a pure function of ctx.
 */
export const CONCEPT_CHECKS = {
  single: [
    {
      id: 'ttft-context-doubling',
      question: 'Predict: doubling context from 4k→8k tokens — does TTFT double?',
      choices: [
        { label: 'Yes — TTFT roughly doubles', correct: true },
        { label: 'No — TTFT barely changes' },
        { label: 'It depends on output length' }
      ],
      reveal: (ctx) => (
        `TTFT = prompt tokens ÷ prefill speed, so scaling is strictly linear. ` +
        `Right now ${formatTokens(ctx.promptTokens)} prefill tokens @ ${formatTokens(Math.round(ctx.prefillSpeed))} tok/s ` +
        `put the first token at ≈ ${formatTime(ctx.ttft)}. Double the tokens and prefill has twice the work: ≈ ${formatTime(ctx.ttft * 2)}. ` +
        `Output length never enters the equation.`
      )
    },
    {
      id: 'output-length-ttft',
      question: 'Predict: raising target output from 256 → 2048 tokens changes TTFT how?',
      choices: [
        { label: 'TTFT increases proportionally' },
        { label: 'TTFT stays exactly the same', correct: true },
        { label: 'TTFT decreases slightly' }
      ],
      reveal: (ctx) => (
        `The first token only waits for Phase 1 (prefill). Your current setup — ` +
        `${formatTokens(ctx.promptTokens)} tokens @ ${formatTokens(Math.round(ctx.prefillSpeed))} tok/s — lands it at ≈ ${formatTime(ctx.ttft)} ` +
        `no matter how many tokens follow. The extra output stretches Phase 2 instead: ` +
        `${formatTokens(ctx.outputTokens)} decode tokens @ ${formatTokens(Math.round(ctx.decodeSpeed))} tok/s is what gets slower.`
      )
    }
  ],

  agentic: [
    {
      id: 'prefix-caching-turn1',
      question: 'With prefix caching ON, which turn still prefills the full base prompt?',
      choices: [
        { label: 'Turn 1 — nothing is cached yet', correct: true },
        { label: 'Every turn re-prefills everything' },
        { label: 'None — caching covers all turns' }
      ],
      reveal: (ctx) => {
        const saved = Number.isFinite(ctx.savedPct) ? Math.round(ctx.savedPct) : 0;
        return (
          `Before turn 1 the KV cache is empty, so the full system prompt is paid exactly once at full price. ` +
          `From turn 2 onward only the new ΔP tokens are prefilled. In this loop that saves ≈ ${saved}% of total walltime ` +
          `(${formatTime(ctx.walltime)} with caching vs ${formatTime(ctx.noCacheWalltime)} without).`
        );
      }
    },
    {
      id: 'turn-growth-flat',
      question: 'Predict: as the agent loop keeps adding turns, per-turn walltime with prefix caching…',
      choices: [
        { label: 'Stays roughly flat', correct: true },
        { label: 'Grows linearly with history size' },
        { label: 'Grows quadratically' },
        { label: 'Halves every turn' }
      ],
      reveal: () => (
        `Each new turn only prefills its own new tokens (tool output + next request), not the accumulated history, ` +
        `so turn cost stays ~constant while total context grows. Without caching every turn would re-prefill the whole ` +
        `conversation — the reason long agent loops collapse without a cached prefix.`
      )
    }
  ],

  kvcache: [
    {
      id: 'kv-context-doubling',
      question: 'Predict: doubling context length does what to KV cache VRAM?',
      choices: [
        { label: 'Doubles it', correct: true },
        { label: 'Quadruples it' },
        { label: 'Leaves it unchanged' },
        { label: 'Grows it, then it caps out' }
      ],
      reveal: (ctx) => (
        `KV cache is stored per token, so total size scales linearly with context: ` +
        `${ctx.bytesPerToken.toFixed(2)} B/token × ${formatTokens(ctx.contextLength)} tokens × batch ${ctx.batch} ` +
        `≈ ${ctx.gb.toFixed(2)} GB for ${ctx.model} right now — double the slider and that figure doubles. ` +
        `(On hybrid-attention models some layers cap at their sliding window, so real growth can be slightly under 2× — never more.)`
      )
    },
    {
      id: 'kv-batch-linear',
      question: 'Predict: raising batch from 1 → 4 concurrent sequences does what to total KV cache?',
      choices: [
        { label: '×4 — each sequence keeps its own cache', correct: true },
        { label: 'Stays the same — sequences share KV' },
        { label: 'Only slightly higher — KV is deduplicated' }
      ],
      reveal: (ctx) => (
        `Total KV = bytes/token × context × batch. Every concurrent sequence materializes its own key/value tensors ` +
        `for the whole prompt — nothing is shared across sequences. At batch ${ctx.batch} you are at ≈ ${ctx.gb.toFixed(2)} GB; ` +
        `at 4× the batch that becomes ≈ ${(ctx.gb * 4 / (ctx.batch || 1)).toFixed(2)} GB.`
      )
    }
  ]
};

const STORAGE_KEY = 'llmpd-concept-checks-v1';

/** Full progress map: { [tab]: { [checkId]: wasCorrect } }. Never throws. */
export function getProgress() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // storage unavailable or corrupt — treat as fresh
  }
}

export function recordAnswer(tab, checkId, wasCorrect) {
  try {
    const progress = getProgress();
    progress[tab] = { ...(progress[tab] || {}), [checkId]: Boolean(wasCorrect) };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // storage unavailable — progress just lives in component state for this visit
  }
}

export function resetProgress() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Checks defined for a tab (empty array for tabs without quizzes). */
export function checksForTab(tab) {
  return CONCEPT_CHECKS[tab] || [];
}

/**
 * Progress summary for one tab: answered count, correct count, total checks.
 * Reads stored progress when no answers map is passed.
 */
export function progressForTab(tab, answers = getProgress()[tab] || {}) {
  const checks = checksForTab(tab);
  let answered = 0;
  let correct = 0;
  for (const check of checks) {
    if (answers[check.id] !== undefined) {
      answered += 1;
      if (answers[check.id]) correct += 1;
    }
  }
  return { answered, correct, total: checks.length };
}
