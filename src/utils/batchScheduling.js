// Continuous batching & chunked prefill scheduler (issue #54).
//
// SIMPLIFIED SCHEDULING MODEL — documented so the numbers stay honest:
//
// - Simulated time advances in discrete ENGINE STEPS. One step ≈ one forward
//   pass of the serving engine (llama.cpp `--parallel` / vLLM step).
// - Every running sequence that has finished prefill emits exactly ONE decode
//   token per step (autoregressive decoding).
// - A step may also carry ONE prefill chunk, served FCFS across the admitted
//   sequences still ingesting their prompt. Chunked prefill slices a prompt
//   into chunks of ≤ `chunkSize` tokens; with chunking disabled the whole
//   remaining prompt is ingested in a single step.
// - Step duration = max(decodeStepTime, prefillChunkTime) where
//   decodeStepTime = 1000 / decodeSpeed and
//   prefillChunkTime = chunkTokens / prefillSpeed.
//   That max() is the crux of the visualization: an unchunked multi-thousand-
//   token prefill stretches its step far beyond one decode period, stalling
//   EVERY decoding sequence in the batch — visible as inter-token latency
//   (ITL) spikes. Chunked prefill caps that stretch per step.
// - Continuous batching admits queued requests whenever a batch slot is free
//   at a step boundary — running sequences never wait for a whole cohort to
//   finish. Static batching (mode 'static', see simulateStaticBatching)
//   prefills a fixed cohort, decodes it to completion, then starts the next:
//   early finishers waste slots and later arrivals idle in queue.

const MAX_STEPS = 20000; // safety cap: malformed params can't hang the tab

// Deterministic PRNG (mulberry32) so a given seed always renders the same
// workload — shareable URLs and screenshots stay reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a deterministic request workload with staggered arrivals.
 * Prompt/output lengths vary ±40% around their means; arrivals are jittered
 * multiples of the base interval so requests trickle in instead of landing
 * simultaneously.
 */
export function generateRequests({
  numRequests,
  meanPromptTokens,
  meanOutputTokens,
  arrivalIntervalMs,
  seed = 42
}) {
  const rand = mulberry32(seed);
  const vary = (mean) => Math.max(1, Math.round(mean * (0.6 + 0.8 * rand())));
  const requests = [];
  for (let i = 0; i < numRequests; i++) {
    requests.push({
      id: i + 1,
      promptTokens: vary(meanPromptTokens),
      outputTokens: vary(meanOutputTokens),
      arrivalTime: (i * arrivalIntervalMs * (0.5 + rand())) / 1000 // seconds
    });
  }
  return requests.sort((a, b) => a.arrivalTime - b.arrivalTime || a.id - b.id);
}

/**
 * Simulate continuous batching with optional chunked prefill.
 *
 * @returns {{steps: Array, requests: Array, makespan: number, summary: Object}}
 *   steps[]    — one record per engine step (see module docblock)
 *   requests[] — per-request timeline: firstTokenTime, finishTime, itls[]
 *   summary    — aggregate metrics for the metric cards
 */
export function simulateBatching({
  requests,
  maxBatchSize,
  chunkSize,
  prefillSpeed,
  decodeSpeed
}) {
  const decodeStepTime = decodeSpeed > 0 ? 1 / decodeSpeed : Infinity; // seconds
  const chunkingOn = Number.isFinite(chunkSize) && chunkSize > 0;

  const state = new Map(requests.map(r => [r.id, {
    ...r,
    remainingPrompt: r.promptTokens,
    decoded: 0,
    firstTokenTime: null,
    itls: [],
    lastTokenTime: null,
    finishTime: null
  }]));
  const order = requests.map(r => r.id); // FCFS arrival order
  const steps = [];
  let running = [];      // ids currently in the batch
  let queuedIdx = 0;     // next index into `order` not yet admitted
  let t = 0;

  while ((queuedIdx < order.length || running.length > 0) && steps.length < MAX_STEPS) {
    // --- Admission: fill free slots with arrived requests (continuous batching). ---
    const admitted = [];
    while (
      running.length < maxBatchSize &&
      queuedIdx < order.length &&
      state.get(order[queuedIdx]).arrivalTime <= t + 1e-12
    ) {
      const id = order[queuedIdx++];
      running.push(id);
      admitted.push(id);
    }

    if (running.length === 0) {
      // Batch empty but next arrival is in the future — skip idle time.
      t = Math.max(t, state.get(order[queuedIdx]).arrivalTime);
      continue;
    }

    // --- Prefill budget: at most one chunk this step, FCFS. ---
    let prefill = null;
    for (const id of running) {
      const s = state.get(id);
      if (s.remainingPrompt > 0) {
        const tokens = chunkingOn
          ? Math.min(chunkSize, s.remainingPrompt)
          : s.remainingPrompt; // unchunked: entire remaining prompt at once
        s.remainingPrompt -= tokens;
        prefill = { id, tokens };
        break;
      }
    }

    // --- Decode: one token for every sequence whose prefill is complete. ---
    const decodedIds = [];
    for (const id of running) {
      const s = state.get(id);
      if (s.remainingPrompt === 0) decodedIds.push(id);
    }

    const prefillChunkTime = prefill ? prefill.tokens / prefillSpeed : 0;
    const duration = Math.max(decodeStepTime, prefillChunkTime);
    const tStart = t;
    const tEnd = t + duration;

    for (const id of decodedIds) {
      const s = state.get(id);
      s.decoded += 1;
      if (s.firstTokenTime === null) s.firstTokenTime = tEnd;
      else s.itls.push(tEnd - s.lastTokenTime);
      s.lastTokenTime = tEnd;
      if (s.decoded >= s.outputTokens) {
        s.finishTime = tEnd;
      }
    }

    steps.push({
      index: steps.length,
      tStart,
      tEnd,
      duration,
      batchSize: running.length,
      admitted,
      finished: [],
      prefill,
      decoded: decodedIds
    });
    const step = steps[steps.length - 1];

    // --- Retirement: finished sequences free their slots immediately. ---
    running = running.filter(id => {
      const s = state.get(id);
      if (s.finishTime !== null && s.finishTime <= tEnd + 1e-12) {
        step.finished.push(id);
        return false;
      }
      return true;
    });

    t = tEnd;
  }

  const enriched = order.map(id => {
    const s = state.get(id);
    return {
      id: s.id,
      promptTokens: s.promptTokens,
      outputTokens: s.outputTokens,
      arrivalTime: s.arrivalTime,
      firstTokenTime: s.firstTokenTime,
      finishTime: s.finishTime,
      ttft: s.firstTokenTime !== null ? s.firstTokenTime - s.arrivalTime : null,
      itls: s.itls
    };
  });

  return { steps, requests: enriched, makespan: t, summary: summarize(enriched, steps, maxBatchSize) };
}

/**
 * Static-batching baseline: serve fixed cohorts of `maxBatchSize` back to
 * back. A cohort's prompts are prefilled in one batched pass, then every
 * sequence decodes one token per step until the LAST one finishes (early
 * finishers hold their slot — the padding waste static batching is known
 * for). Used only for the comparison banner; shares the timing model above.
 */
export function simulateStaticBatching({ requests, maxBatchSize, prefillSpeed, decodeSpeed }) {
  const decodeStepTime = decodeSpeed > 0 ? 1 / decodeSpeed : Infinity; // seconds
  const steps = [];
  const enriched = [];
  let t = 0;

  for (let start = 0; start < requests.length; start += maxBatchSize) {
    const group = requests.slice(start, start + maxBatchSize);
    const queueWait = Math.max(0, ...group.map(r => r.arrivalTime));
    t = Math.max(t, queueWait);

    // Cohort prefill: all prompts in one batched pass (compute-bound GEMM).
    const groupPromptTokens = group.reduce((acc, r) => acc + r.promptTokens, 0);
    const prefillTime = groupPromptTokens / prefillSpeed;
    const tPrefillEnd = t + prefillTime;
    steps.push({
      index: steps.length,
      tStart: t,
      tEnd: tPrefillEnd,
      duration: prefillTime,
      batchSize: group.length,
      admitted: group.map(r => r.id),
      finished: [],
      prefill: { id: group.map(r => r.id), tokens: groupPromptTokens },
      decoded: []
    });

    // Decode loop: step until the longest output in the cohort is done.
    const maxOutput = Math.max(...group.map(r => r.outputTokens));
    for (let tok = 1; tok <= maxOutput; tok++) {
      const tStart = tPrefillEnd + (tok - 1) * decodeStepTime;
      const tEnd = tStart + decodeStepTime;
      const decoded = group.filter(r => tok <= r.outputTokens).map(r => r.id);
      const finished = group.filter(r => tok === r.outputTokens).map(r => r.id);
      steps.push({
        index: steps.length,
        tStart,
        tEnd,
        duration: decodeStepTime,
        batchSize: group.filter(r => tok <= r.outputTokens).length,
        admitted: [],
        finished,
        prefill: null,
        decoded
      });
      t = tEnd;
    }

    for (const r of group) {
      enriched.push({
        ...r,
        firstTokenTime: tPrefillEnd,
        finishTime: tPrefillEnd + r.outputTokens * decodeStepTime,
        ttft: tPrefillEnd - r.arrivalTime,
        itls: Array.from({ length: r.outputTokens - 1 }, () => decodeStepTime)
      });
    }
  }

  const makespan = t;
  return { steps, requests: enriched, makespan, summary: summarize(enriched, steps, maxBatchSize) };
}

/** Aggregate metrics shared by both scheduling modes. */
function summarize(requests, steps, maxBatchSize) {
  const done = requests.filter(r => r.finishTime !== null);
  const makespan = done.length ? Math.max(...done.map(r => r.finishTime)) : 0;
  const totalOutput = done.reduce((acc, r) => acc + r.outputTokens, 0);
  const ttfts = done.map(r => r.ttft).filter(Number.isFinite);
  const itls = done.flatMap(r => r.itls);
  const busySteps = steps.filter(s => s.batchSize > 0);
  return {
    makespan,
    totalOutputTokens: totalOutput,
    throughput: makespan > 0 ? totalOutput / makespan : 0,
    avgTTFT: ttfts.length ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : 0,
    maxTTFT: ttfts.length ? Math.max(...ttfts) : 0,
    avgITL: itls.length ? itls.reduce((a, b) => a + b, 0) / itls.length : 0,
    maxITL: itls.length ? Math.max(...itls) : 0,
    occupancyPct: busySteps.length
      ? (busySteps.reduce((acc, s) => acc + s.batchSize, 0) / busySteps.length / maxBatchSize) * 100
      : 0,
    stalledStepPct: steps.length
      ? (steps.filter(s => s.prefill !== null).length / steps.length) * 100
      : 0
  };
}
