// Curriculum mode (issue #89) — ordered lessons that lock the simulator to a
// preset scenario, pose a prediction question, then let the learner verify
// their answer against the live simulation ("prediction-then-verify").
//
// Each lesson REUSES an existing tab as its lesson backend:
//   single  -> SingleTurnVisualizer (TTFT / TPOT / speculative decoding)
//   agentic -> AgenticVisualizer   (prefix caching across loop turns)
//   kvcache -> KVCacheCalculator   (KV memory geometry)
//
// `demo` holds the exact URL params passed through demoUrl(), mirroring the
// FAQ_DEMOS deep-links in TheoryGuide.jsx, so "run it" opens the backend tab
// preconfigured and autoplaying.

export const CURRICULUM_STORAGE_KEY = 'llmpd-curriculum-progress';

export const LESSONS = [
  {
    id: 'ttft-basics',
    title: 'TTFT basics',
    tagline: 'Prompt length sets time-to-first-token',
    backendTab: 'single',
    setup:
      'Locked preset: RTX 4090 running EXL2 (prefill 3800 tok/s). A 2048-token prompt gives TTFT = 2048 ÷ 3800 ≈ 0.54 s.',
    question: 'What happens to TTFT if we 4× the prompt to 8192 tokens?',
    options: [
      'TTFT stays about the same (~0.5 s)',
      'TTFT grows ~4× to ~2.2 s',
      'TTFT grows ~16× to ~8.6 s',
      'TTFT halves — larger prompts prefill more efficiently'
    ],
    correctIndex: 1,
    explanation:
      'Prefill ingests every prompt token but TTFT scales linearly with prompt length: TTFT = promptTokens ÷ prefillSpeed. 4× the tokens means 4× the wait: 8192 ÷ 3800 ≈ 2.2 s. Watch the waterfall\'s first-token marker slide right when you run the 8192-token preset.',
    verify: 'Watch the TTFT metric and where the first token lands on the timeline.',
    demo: { tab: 'single', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, prompt: 8192, output: 256, sim: 5 }
  },
  {
    id: 'tpot',
    title: 'TPOT',
    tagline: 'Output length stretches total time, not per-token pace',
    backendTab: 'single',
    setup:
      'Same RTX 4090 preset (decode 105 tok/s), 1024-token prompt. At 105 tok/s decode, TPOT = 1000 ÷ 105 ≈ 9.5 ms per token.',
    question: 'If we raise the output from 512 to 2048 tokens, what happens to per-token time (TPOT)?',
    options: [
      'TPOT stays ~9.5 ms/tok — only total generation time (~4×) grows',
      'TPOT doubles to ~19 ms/tok',
      'TPOT quadruples too — later tokens get progressively slower',
      'TPOT drops — long generations amortize startup cost'
    ],
    correctIndex: 0,
    explanation:
      'Decode produces strictly one token per step, and each step costs the same regardless of how many tokens came before. So TPOT is constant (~9.5 ms here); the 4× output simply multiplies total decode time by 4. In the sim, watch the steady spacing of tokens in the decode phase while the overall bar gets longer.',
    verify: 'Compare the TPOT metric before/after changing Output Tokens — it should not move.',
    demo: { tab: 'single', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, prompt: 1024, output: 2048, sim: 10 }
  },
  {
    id: 'prefill-vs-decode',
    title: 'Why prefill ≠ decode',
    tagline: 'Compute-bound ingestion vs bandwidth-bound generation',
    backendTab: 'single',
    setup:
      'One GPU, both phases: prefill processes 3800 tok/s (~0.26 ms of work per token) while decode crawls along at 105 tok/s (~9.5 ms per token). Same hardware, ~36× difference in per-token time.',
    question: 'Why is per-token work during decode ~36× slower than during prefill?',
    options: [
      'Decode runs on a smaller partition of the GPU while prefill uses all of it',
      'Prefill is compute-bound — all prompt tokens flow through parallel GEMMs; decode is bandwidth-bound — every step re-streams weights + KV cache from VRAM for a single token',
      'Decode has to pause while the CPU appends each token to the context',
      'It isn\'t really slower — TPOT is just measured differently from prefill speed'
    ],
    correctIndex: 1,
    explanation:
      'During prefill the N prompt tokens ride through the matrix-multiplies together, keeping the GPU\'s compute units saturated. During decode there is only one token per step, so arithmetic intensity collapses and the step time is dominated by fetching weights and the KV cache over the memory bus. That\'s why faster VRAM bandwidth speeds up decode while faster compute speeds up prefill.',
    verify: 'In the waterfall, compare the dense prefill block against the long thin decode tail.',
    demo: { tab: 'single', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, prompt: 2048, output: 512, sim: 5 }
  },
  {
    id: 'prefix-caching',
    title: 'Prefix caching',
    tagline: 'Stop re-prefilling the same conversation history',
    backendTab: 'agentic',
    setup:
      'Agentic loop locked to 6 turns, 4096-token base prompt, 1024 tool-output tokens and 250 generated tokens per turn — with prefix caching OFF.',
    question: 'With prefix caching off, how does turn 6\'s prefill work compare to turn 1\'s?',
    options: [
      'Roughly equal — each turn prefills only its own new tokens',
      'Much larger — every turn re-prefills the entire growing conversation, so prefill time climbs each turn',
      'Zero after the first turn — nothing needs re-prefilling',
      'Unpredictable — it depends on the tool outputs'
    ],
    correctIndex: 1,
    explanation:
      'Without a cached prefix, the loop treats each turn as brand new: the full P tokens accumulated so far are re-prefilled every time, so prefill cost grows roughly with the square of the number of turns. Toggle Prefix caching ON and rerun: each turn then prefills only its ΔP new tokens and walltime flattens.',
    verify: 'Compare the stacked prefill blocks per turn with caching OFF, then flip the toggle and rerun.',
    demo: { tab: 'agentic', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, turns: 6, sprompt: 4096, tool: 1024, thought: 250, cache: 'false', sim: 20 }
  },
  {
    id: 'spec-decoding',
    title: 'Speculative decoding',
    tagline: 'Draft cheaply, verify in parallel — until acceptance drops',
    backendTab: 'single',
    setup:
      'Speculative decoding ON with k=4 draft tokens and 70% acceptance on the RTX 4090 preset (vanilla decode 105 tok/s). The draft step costs ~20% of a target step.',
    question: 'What effective decode throughput do you predict versus the 105 tok/s baseline?',
    options: [
      '~105 tok/s — speculation never beats plain decoding',
      '~220 tok/s (≈2×) — accepted drafts + the bonus token outweigh the extra draft-step cost',
      '~525 tok/s (=5×) — one verification step yields five tokens',
      '~20 tok/s — verifying drafts costs more than it saves'
    ],
    correctIndex: 1,
    explanation:
      'Effective tok/s = decodeSpeed × (1 + k·α) ÷ (1 + k·draftCost) = 105 × 3.8 ÷ 1.8 ≈ 220. Not 5×, because each round still pays for drafting and rejects ~30% of proposals. The breakeven sits at α ≈ draftCost ≈ 0.2: below it speculation loses to plain decoding. The simulator clamps acceptance no lower than 30%, so drag the slider to that floor and watch nearly all of the ~2× speedup evaporate.',
    verify: 'Read the effective tok/s shown next to the spec controls, then drag acceptance down to its 30% minimum and compare.',
    demo: { tab: 'single', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, prompt: 1024, output: 512, spec: '1', draftK: 4, acc: 0.7, sim: 10 }
  },
  {
    id: 'kv-memory-math',
    title: 'KV memory math',
    tagline: 'Context length buys memory linearly',
    backendTab: 'kvcache',
    setup:
      'LLaMA-3.3 70B (GQA, 80 layers × 8 KV heads × 128 head dim) in BF16: 2 × 8 × 128 × 2 B × 80 layers ≈ 320 KB per token. At 32K context that\'s ~10 GB of KV cache.',
    question: 'What happens to KV cache memory if we jump from 32K to 128K context?',
    options: [
      'Stays flat — model weights dominate memory at any context',
      'Roughly quadruples (~10 GB → ~40 GB) — KV bytes scale linearly with context',
      'Doubles — attention cost is logarithmic in context length',
      'Shrinks — longer contexts get compressed automatically'
    ],
    correctIndex: 1,
    explanation:
      'Every token in the sequence stores exactly the same KV footprint (≈320 KB for this model in BF16), so total KV = bytesPerToken × context. 4× the context is 4× the memory: ~40 GB, which alone exceeds a 24–48 GB card before you even count the 70B weights. Try halving precision to FP8 in the calculator and watch the per-token KB drop by half.',
    verify: 'Set Context Length to 131072 in the calculator and read the total KV GB.',
    demo: { tab: 'kvcache', model: 'llama70b', ctx: 131072, prec: 2 }
  }
];

/** Pure answer check so tests (and the UI) agree on correctness. */
export function checkAnswer(lessonId, choiceIndex) {
  const lesson = LESSONS.find(l => l.id === lessonId);
  if (!lesson) return false;
  return choiceIndex === lesson.correctIndex;
}

function safeStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // storage unavailable (private mode) — progress is session-only
  }
}

/** Progress shape: { completed: { [lessonId]: completionTimestamp },
 *  attempted: { [lessonId]: checkCount } } — attempted tracks wrong answers
 *  too (issue #1022: success-only storage conflated "never tried" with
 *  "tried and failed"). */
export function loadProgress(storage = safeStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem(CURRICULUM_STORAGE_KEY) || '');
    if (parsed && typeof parsed === 'object') {
      return {
        completed: parsed.completed && typeof parsed.completed === 'object' ? parsed.completed : {},
        attempted: parsed.attempted && typeof parsed.attempted === 'object' ? parsed.attempted : {}
      };
    }
  } catch {
    // missing/corrupt entry falls through to a fresh record
  }
  return { completed: {}, attempted: {} };
}

export function saveProgress(progress, storage = safeStorage()) {
  try {
    storage?.setItem(CURRICULUM_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // ignore — progress just won't persist
  }
  return progress;
}

export function isComplete(progress, lessonId) {
  return Boolean(progress?.completed?.[lessonId]);
}

/** Record one answer check — correct or not — against a lesson (#1022). */
export function markAttempted(progress, lessonId) {
  const attempted = { ...(progress?.attempted || {}) };
  attempted[lessonId] = (attempted[lessonId] || 0) + 1;
  return {
    completed: progress?.completed || {},
    attempted
  };
}

/** How many times a lesson's answer was checked, right or wrong (#1022). */
export function attemptCount(progress, lessonId) {
  return progress?.attempted?.[lessonId] || 0;
}

/** Index of the first unfinished lesson (for "continue where you left off"), or -1. */
export function nextIncompleteLesson(progress) {
  return LESSONS.findIndex(l => !isComplete(progress, l.id));
}
