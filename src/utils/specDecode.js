// Speculative decoding math + known-good draft/target pairings.
//
// Model (matches api/_math.js `speculative`): the draft proposes k tokens per
// step, the target verifies them in one forward pass. Each step therefore
// costs (1 + k·c) target-step equivalents (c = draft step cost as a fraction
// of a target step) and yields (1 + k·α) tokens (accepted drafts + bonus).
//
//   effective = baseDecodeSpeed × (1 + k·α) / (1 + k·c)
//
// Solving effective = base gives the breakeven acceptance rate α* = c:
// below it, speculation is slower than plain autoregressive decode.

export const DEFAULT_DRAFT_COST = 0.2; // draft step ≈ 20% of a target step

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

// Speedup vs vanilla decode for a given (k, α, c). 1.0 = no gain.
export function specSpeedup(k, acceptanceRate, draftCostFraction = DEFAULT_DRAFT_COST) {
  const kk = Math.max(1, k);
  const c = clamp01(draftCostFraction);
  const alpha = clamp01(acceptanceRate);
  return (1 + kk * alpha) / (1 + kk * c);
}

// Acceptance rate below which speculation is a net loss. In the linear
// verify-cost model this equals the draft cost fraction, independent of k —
// computed from the model equation rather than hard-coded so the two stay in
// sync if the model is ever refined.
export function breakevenAcceptance(draftCostFraction = DEFAULT_DRAFT_COST) {
  const c = clamp01(draftCostFraction);
  // (1 + k·α) / (1 + k·c) = 1  ⇒  α* = c
  return c;
}

// Effective decode speed with speculation, tok/s. Mirrors api/_math.js.
export function effectiveSpecSpeed(baseDecodeSpeed, k, acceptanceRate, draftCostFraction = DEFAULT_DRAFT_COST) {
  if (!Number.isFinite(baseDecodeSpeed) || baseDecodeSpeed <= 0) return 0;
  return baseDecodeSpeed * specSpeedup(k, acceptanceRate, draftCostFraction);
}

// Known-good draft/target pairs with typical acceptance rates reported by
// published write-ups and community runs (Qwen3 blog, EAGLE-3 paper,
// llama.cpp / vLLM discussion benchmarks). These are ranges over generic
// chat/code workloads — coding-heavy or templated prompts accept noticeably
// higher, adversarial or highly-creative text lower. Values are approximate;
// treat them as starting points, not measurements of your workload.
export const DRAFT_TARGET_PAIRS = [
  {
    id: 'qwen3-06b-qwen3-32b',
    draft: 'Qwen3-0.6B',
    target: 'Qwen3-32B',
    family: 'Qwen3',
    suggestedK: 4,
    acceptanceRange: [0.6, 0.8],
    speedupRange: [1.5, 2.5],
    source: 'Qwen3 blog · community llama.cpp/vLLM runs'
  },
  {
    id: 'qwen25-05b-qwen25-32b',
    draft: 'Qwen2.5-0.5B',
    target: 'Qwen2.5-7B … 72B',
    family: 'Qwen2.5',
    suggestedK: 4,
    acceptanceRange: [0.55, 0.75],
    speedupRange: [1.4, 2.0],
    source: 'community vLLM spec-decode benchmarks'
  },
  {
    id: 'llama32-1b-llama31-8b',
    draft: 'Llama-3.2-1B',
    target: 'Llama-3.1-8B',
    family: 'Llama 3',
    suggestedK: 4,
    acceptanceRange: [0.6, 0.8],
    speedupRange: [1.5, 2.2],
    source: 'llama.cpp speculative discussions'
  },
  {
    id: 'llama32-1b-llama33-70b',
    draft: 'Llama-3.2-1B',
    target: 'Llama-3.3-70B',
    family: 'Llama 3',
    suggestedK: 5,
    acceptanceRange: [0.5, 0.7],
    speedupRange: [1.3, 1.9],
    source: 'community multi-GPU runs'
  },
  {
    id: 'eagle3-llama31-8b',
    draft: 'EAGLE-3 head (trained)',
    target: 'Llama-3.1-8B',
    family: 'Llama 3 · trained head',
    suggestedK: 6,
    acceptanceRange: [0.75, 0.9],
    speedupRange: [3.0, 4.5],
    source: 'EAGLE-3 paper (2025) — trained draft head, not an off-the-shelf model'
  },
  {
    id: 'ds-r1-1.5b-ds-r1-32b',
    draft: 'DeepSeek-R1-Distill-Qwen-1.5B',
    target: 'DeepSeek-R1-Distill-Qwen-32B',
    family: 'DeepSeek R1 distills',
    suggestedK: 4,
    acceptanceRange: [0.55, 0.75],
    speedupRange: [1.4, 2.0],
    source: 'community reasoning-workload runs'
  }
];

// Pairing suggestions, optionally narrowed to a target family keyword
// (e.g. 'qwen', 'llama'). Returns pairs sorted by the midpoint of their
// reported speedup range, best first.
export function suggestPairs(familyQuery = '') {
  const q = familyQuery.trim().toLowerCase();
  const matches = q
    ? DRAFT_TARGET_PAIRS.filter(p => `${p.family} ${p.draft} ${p.target}`.toLowerCase().includes(q))
    : [...DRAFT_TARGET_PAIRS];
  return matches.sort((a, b) => {
    const mid = p => (p.speedupRange[0] + p.speedupRange[1]) / 2;
    return mid(b) - mid(a);
  });
}

// Midpoint acceptance rate for a pair, clamped into the UI slider's range.
export function pairAcceptance(pair, min = 0.3, max = 0.95) {
  const [lo, hi] = pair.acceptanceRange;
  return Math.min(max, Math.max(min, (lo + hi) / 2));
}
