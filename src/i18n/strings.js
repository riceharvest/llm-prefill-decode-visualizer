// i18n scaffold (#85 / #64) — every user-facing UI string lives here.
//
// Usage in components:
//   import { t } from '../i18n/strings';
//   t('header.brandTitle')
//   t('speedControls.decodeHint', { tpot: '2.3' })   // {param} interpolation
//
// Adding a locale:
//   1. Add a new object under `locales` mirroring the `en` shape.
//   2. Set its meta.direction to 'rtl' for RTL languages (ar, he, fa…).
//   3. Activate it at runtime with setLocale('xx') or via the ?lang= URL param.
//
// Missing keys fall back to English, then to the key itself, so partial
// translations never render blank UI.

export const locales = {
  en: {
    meta: { name: 'English', direction: 'ltr' },

    common: {
      pause: 'Pause',
      reset: 'Reset',
      simulateRun: 'Simulate Run',
      startSimulation: 'Start Simulation',
      pauseSimulation: 'Pause Simulation',
      tok: 'tok',
      tokPerSec: 'tok/s',
      retry: 'Retry',
      copied: 'Copied',
      share: 'Share',
      applied: 'Applied',
      selected: 'Selected',
      instant: 'INST'
    },

    app: {
      footerTagline: 'Open source inference benchmark instrument',
      shortcutsPrefix: 'Shortcuts:',
      shortcutPlay: 'play/pause',
      shortcutReset: 'reset',
      shortcutTabs: 'switch tabs',
      agentsLinePrefix: 'AI agents: all data available as JSON —'
    },

    header: {
      brandTitle: 'LLM Prefill & Decode Speed Visualizer',
      brandSubtitle: 'Measure walltime, TTFT & TPOT across single-turn chat and multi-turn agentic loops',
      presetLabel: 'Preset',
      localMaxxingRun: 'LocalMaxxing measured run',
      shareTooltip: 'Copy share link with current settings',
      navAriaLabel: 'Visualizer sections'
    },

    tabs: {
      single: { label: 'Single-Turn Chat', hint: 'TTFT / TPOT' },
      agentic: { label: 'Agentic Loop', hint: 'WALLTIME' },
      compare: { label: 'Hardware Compare', hint: 'A / B' },
      ab: { label: 'A/B Replay', hint: 'SYNC' },
      diff: { label: 'Run Diff', hint: 'RUN IDS' },
      kvcache: { label: 'KV Cache', hint: 'VRAM' },
      theory: { label: 'Theory', hint: 'FLOPS vs BW' }
    },

    speedControls: {
      ariaLabel: 'Simulation speed controls',
      prefillSpeed: 'Prefill Speed',
      computeBound: 'compute bound',
      decodeSpeed: 'Decode Speed',
      bandwidthBound: 'bandwidth bound',
      prefillAria: 'Prefill speed in tokens per second',
      prefillValueAria: 'Prefill speed value',
      decodeAria: 'Decode speed in tokens per second',
      decodeValueAria: 'Decode speed value',
      prefillHint: 'Prompt processing — parallel ingestion of all prompt tokens into the KV cache (sets TTFT)',
      decodeHint: 'Token generation — 1 token per step (TPOT = {tpot} ms/tok)',
      timeScale: 'Time Scale',
      timeScaleAria: 'Visual time scale',
      resetTooltip: 'Reset visualizer'
    },

    singleTurn: {
      paramsPanelAria: 'Single-turn chat parameters',
      paramsPanelTitle: 'Single-Turn Chat Parameters',
      scenarioGroupAria: 'Workload scenario presets',
      speculativeDecoding: 'Speculative Decoding:',
      specOn: 'ON',
      specOff: 'OFF',
      effectiveTag: 'effective {speed} tok/s ({multiplier}× vs vanilla)',
      draftTokensPerStep: 'Draft tokens / step (k)',
      draftTokensAria: 'Draft tokens proposed per step',
      acceptanceRate: 'Acceptance rate (α)',
      acceptanceAria: 'Draft token acceptance rate',
      specHint: 'Draft model proposes k tokens, target verifies in one pass. Effective speed ≈ base ÷ (1 + k·c_draft) × (1 + k·α), draft cost c≈0.2. Higher α or smaller k → bigger win.',
      inputPromptLength: 'Input Prompt Length',
      promptLengthAria: 'Input prompt length in tokens',
      promptValueAria: 'Input prompt length value',
      scalePromptShort: '128 · short',
      scalePromptRag: '4,096 · RAG',
      scalePromptLongDoc: '32,768 · long doc',
      targetOutputLength: 'Target Output Length',
      outputLengthAria: 'Target output generation length in tokens',
      outputValueAria: 'Target output generation length value',
      scaleOutputConcise: '32 · concise',
      scaleOutputStandard: '512 · standard',
      scaleOutputCode: '4,096 · code / report',
      simStageAria: 'Simulation stage',
      phaseIdle: 'READY',
      phasePrefill: 'PHASE 1 · PREFILL',
      phaseDecode: 'PHASE 2 · DECODE',
      phaseCompleted: 'COMPLETED',
      resetTooltip: 'Reset simulation (phase, token progress, stream, elapsed time)',
      prefillPhaseTitle: 'Phase 1 · Prefill (TTFT)',
      decodePhaseTitle: 'Phase 2 · Decode (Generation)',
      ingested: 'Ingested',
      ttftLabel: 'TTFT',
      decodeTimeLabel: 'Decode',
      prefillHint: 'Compute-bound parallel matrix multiplication. Builds the KV cache for all {tokens} prompt tokens.',
      generated: 'Generated',
      decodeHint: 'Memory-bandwidth bound autoregressive loop. Reads all model weights & KV cache per generated token.',
      streamSectionLabel: 'Decode stream · {count} tokens',
      tpotLabel: 'TPOT',
      placeholderPrefilling: 'Ingesting prompt — prefill phase active…',
      placeholderWindowDone: 'Window {lap} complete — clearing & continuing…',
      placeholderIdle: 'Press "Simulate Run" to watch the token stream.',
      metricTtft: 'TTFT · time to first token',
      metricTtftSub: 'Prompt prefill latency',
      metricTpot: 'TPOT · time per output token',
      metricThroughput: 'Effective throughput',
      tokensPerSecSub: '{speed} tokens / sec',
      metricTotalWalltime: 'Total chat walltime',
      metricTotalSub: 'Prefill + decode combined',
      metricThroughputSub: 'Total tokens ÷ walltime',
      distributionLabel: 'Walltime distribution',
      distributionPrefill: 'Prefill',
      distributionDecode: 'Decode',
      segmentPrefillTooltip: 'Prefill Time: {time} ({pct}%)',
      segmentDecodeTooltip: 'Decode Time: {time} ({pct}%)'
    },

    agentic: {
      paramsPanelAria: 'Agentic loop parameters',
      paramsPanelTitle: 'Agentic Tool-Loop Parameters',
      prefixCachingOn: 'ON (KV reuse)',
      prefixCachingOff: 'OFF (full re-prefill)',
      agentTurns: 'Agent Turns',
      turnsUnit: 'turns',
      turnsAria: 'Number of agent turns',
      turnsValueAria: 'Number of agent turns value',
      initialSystemPrompt: 'Initial System Prompt',
      systemPromptAria: 'Initial system prompt tokens',
      systemPromptValueAria: 'Initial system prompt tokens value',
      toolResultPerTurn: 'Tool Result / Turn',
      toolOutputAria: 'Tool output tokens per turn',
      toolOutputValueAria: 'Tool output tokens per turn value',
      agentThoughtPerTurn: 'Agent Thought / Turn',
      thoughtAria: 'Decode tokens per turn',
      thoughtValueAria: 'Decode tokens per turn value',
      simStageAria: 'Agent loop simulation',
      multiTurnLoop: 'MULTI-TURN LOOP',
      totalWalltimeLabel: 'Total walltime',
      simulateLoop: 'Simulate Agent Loop',
      resetLoop: 'Reset Loop',
      resetTooltip: 'Reset turn state (active turn, phase, token progress)',
      cachingSavingsPrefix: 'Prefix caching savings:',
      cachingSavingsBody: 'walltime reduced from {without} to {with}',
      savedTag: 'saved {time} ({pct}%)',
      cachingDisabledPrefix: 'Prefix caching disabled:',
      cachingDisabledBody: 'every turn re-prefills the entire accumulated context history. Turn walltimes grow as history expands.',
      turnStreamLabel: 'Turn {turn} stream · prefill ingestion vs decode generation',
      overallProgress: 'Overall loop progress',
      prefillPanelTitle: 'Prefill · prompt ingestion',
      decodePanelTitle: 'Decode · token generation',
      placeholderPrefilling: 'Ingesting prompt context…',
      placeholderWaitingPrefill: 'Waiting for prefill phase…',
      placeholderDecoding: 'Generating tokens…',
      placeholderWaitingDecode: 'Waiting for decode phase…',
      windowDonePrefill: 'Window {lap} complete — {tokens} tokens ingested, clearing & continuing…',
      windowDoneDecode: 'Window {lap} complete — {tokens} tokens generated, clearing & continuing…',
      ingested: 'Ingested',
      generated: 'Generated',
      tokPerWord: '≈{n} tok/word',
      statusPrefilling: 'Prefilling — ingesting prompt tokens',
      statusDecoding: 'Decoding — generating tokens',
      statusCompleted: 'Loop complete',
      statusIdle: 'Run the simulation to see both phases side by side',
      contextGrowth: 'Context (KV cache) growth',
      accumulatedSuffix: '{thousands}k accumulated',
      waterfallLabel: 'Turn-by-turn walltime waterfall',
      legendPrefill: 'Prefill',
      legendDecode: 'Decode',
      exportPngTooltip: 'Export this chart as PNG',
      cachedLabel: 'cached',
      fullIngestLabel: 'full ingest',
      segmentPrefillTooltip: 'Turn {turn} Prefill: {time} ({tokens} tok)',
      segmentDecodeTooltip: 'Turn {turn} Decode: {time} ({tokens} tok)',
      tableHeaders: {
        turn: 'Turn',
        agentPhase: 'Agent Tool Phase',
        historyContext: 'History Context',
        prefilledTokens: 'Prefilled Tokens',
        prefillTime: 'Prefill Time',
        decodeTime: 'Decode Time',
        turnWalltime: 'Turn Walltime',
        cumulative: 'Cumulative'
      },
      turnActions: [
        'User Task & Agent Plan Generation',
        'Tool Call #1: Query Vector DB / RAG',
        'Tool Call #2: Run Data Analysis Code',
        'Tool Call #3: Fetch Web Documentation',
        'Tool Call #4: Structure Final Report',
        'Tool Call #5: Verification & Double-Check'
      ]
    },

    compare: {
      panelAria: 'Hardware comparison',
      panelTitle: 'Side-by-Side Hardware Benchmark',
      comparingBanner: 'Comparing {model} at {quant} across {runs} measured single-stream runs. Select either system below to change hardware.',
      testPromptLength: 'Test Prompt Length',
      testPromptAria: 'Test prompt length in tokens',
      testPromptValueAria: 'Test prompt length value',
      testOutputGeneration: 'Test Output Generation',
      testOutputAria: 'Test output generation length in tokens',
      testOutputValueAria: 'Test output generation length value',
      concurrentUsers: 'Concurrent Users (batch)',
      batchAria: 'Concurrent user batch size',
      batchValueAria: 'Concurrent user batch size value',
      batchHintSingle: 'Single stream — per-user speeds are the raw benchmark numbers.',
      batchHintShared: 'Decode shared {batch}-way: per-user speed drops ~B^0.25, aggregate tok/s still rises.',
      systemAPrimary: 'System A · primary',
      systemAProfileAria: 'System A hardware profile',
      systemBComparison: 'System B · comparison',
      systemBProfileAria: 'System B hardware profile',
      sourceRunLink: 'View LocalMaxxing source run ↗',
      prefillSpeed: 'Prefill speed',
      decodeSpeed: 'Decode speed',
      perUserSuffix: '(per user)',
      aggregateDecodeThroughput: 'Aggregate decode throughput',
      ttftPrompt: 'TTFT (prompt)',
      decodeTime: 'Decode time',
      totalWalltime: 'Total walltime',
      priceLabel: '$ / 1M tok (in · out)',
      priceInPlaceholder: 'in',
      priceOutPlaceholder: 'out',
      priceInAria: 'System {system} input price per million tokens',
      priceOutAria: 'System {system} output price per million tokens',
      costPerRequest: 'Cost per request',
      metricOverall: 'Overall walltime',
      fasterSuffix: '{factor}x faster',
      slowerSuffix: '{factor}x slower',
      metricOverallSub: 'System A vs System B',
      metricPrefillAdvantage: 'Prefill TTFT advantage',
      metricDecodeAdvantage: 'Decode generation advantage'
    },

    kvCache: {
      panelAria: 'KV cache VRAM estimator',
      panelTitle: 'KV Cache Memory (VRAM) Estimator',
      intro: "Every prompt and generated token creates Key and Value matrices stored in GPU VRAM during prefill and decode phases. Model geometry pulled from official HuggingFace config.json and each model's architecture paper. KV math respects the real attention type: GQA, MLA (compressed latent), sliding-window, and DeepSeek-V4's CSA/HCA compressed sparse attention.",
      contextLength: 'Context Length',
      contextAria: 'Context length in tokens',
      contextValueAria: 'Context length value',
      concurrentBatchSize: 'Concurrent Batch Size',
      batchAria: 'Concurrent batch size in sequences',
      batchValueAria: 'Concurrent batch size value',
      seqUnit: 'seq',
      kvPrecision: 'KV Cache Precision',
      precisionGroupAria: 'KV cache precision',
      precisionFp16: 'FP16 · 2B',
      precisionFp8: 'FP8 · 1B',
      precisionInt4: 'INT4 · 0.5B',
      metricKvPerToken: 'KV cache / token',
      metricTotalVram: 'Total KV cache VRAM',
      formulaLabel: 'Formula · {mode}',
      modeMla: 'MLA',
      modeGqaSwa: 'GQA + SWA',
      modeCsaHca: 'CSA/HCA',
      modeGqa: 'GQA',
      exceedsMaxContext: "{tokens} exceeds {model}'s maximum context of {max} tokens — the estimate above is theoretical only.",
      footnoteCsa: "DeepSeek-V4-Flash uses compressed sparse attention (CSA m=4 / HCA m′=128, arXiv 2606.19348): the ~3.6 GB @ 1M figure is the paper's measured KV at mixed BF16/FP8 storage, scaled here by precision and context (linear approximation).",
      footnoteGeneric: '{name} geometry from {source}. KV math follows the actual attention type: {attentionType}.',
      attnMla: 'MLA compresses KV into a latent vector per layer',
      attnSliding: 'sliding-window layers cache only the last window tokens, so long-context KV is bounded',
      attnHybrid: 'only full-attention layers cache per-token KV; linear layers are recurrent',
      attnGqa: 'standard grouped-query attention',
      plannerPanelTitle: 'VRAM Budget Planner',
      plannerIntro: "The full memory ledger: model weights at your quant + KV cache at this context + framework overhead. vLLM and llama.cpp both reserve roughly 10–20% of VRAM for activation buffers, CUDA graphs and compute scratch — skipping it is how people discover OOM at deploy time.",
      weightPrecision: 'Weight Precision',
      weightPrecisionAria: 'Weight quantization precision',
      weightsSource: '{params} params × ~{bpw} bits/weight ≈ {gb}',
      weightsOverrideLabel: 'Measured weights (GB)',
      weightsOverrideAria: 'Measured weights size in GB, overrides the estimate',
      weightsOverrideHint: 'Know the real size? Paste the actual file size from your downloaded GGUF or a LocalMaxxing run page to replace the parameter-count estimate.',
      targetGpu: 'Target GPU VRAM',
      targetGpuAria: 'Target GPU for the fit verdict',
      overheadLabel: 'Framework overhead',
      overheadAria: 'Framework overhead fraction slider',
      ledgerWeights: 'Weights',
      ledgerKv: 'KV cache',
      ledgerOverhead: 'Overhead {pct}%',
      ledgerTotal: 'Total VRAM needed',
      ledgerHeadroom: 'Headroom on {gpu}',
      ledgerOverBudget: '{gb} over capacity',
      gpuLimitMarker: 'GPU limit · {gb}',
      verdictPass: 'PASS — fits with headroom',
      verdictWarn: 'TIGHT — over 90% used, OOM risk at peak usage',
      verdictFail: 'OOM — exceeds VRAM',
      verdictBadgeAria: 'Fit verdict',
      perGpuHeading: 'Fit across common GPUs',
      perGpuIntro: 'Same weights + KV + overhead checked against each card. Click to select.',
      gpuVerdictAria: '{name}: {verdict}',
      unifiedNote: 'Unified-memory systems: macOS reserves a large share of RAM for the OS, so treat these verdicts as optimistic.',
    },

    theory: {
      panelAria: 'Theory and equations',
      panelTitle: 'LLM Inference Mechanics · Prefill vs Decode',
      prefillHeading: '1 · Prefill — prompt ingestion',
      prefillIntroBefore: 'During prefill, the LLM processes the entire input prompt (all ',
      subPrompt: 'prompt',
      prefillIntroAfter: ' tokens) at once. The attention mechanism builds the initial Key-Value (KV) cache for every prompt token.',
      bottleneckLabel: 'Bottleneck:',
      operationLabel: 'Operation:',
      userMetricLabel: 'User metric — ',
      bottleneckCompute: 'compute-bound (tensor cores / FLOPs).',
      operationGemm: 'matrix-matrix multiplication (GEMM). High arithmetic intensity.',
      metricTtft: 'TTFT (time to first token):',
      formulaTtft: 'TTFT = prompt tokens / prefill speed',
      decodeHeading: '2 · Decode — autoregressive generation',
      decodeIntroBefore: 'During decode, tokens are generated strictly one by one. For every generated token, the GPU must read all model parameters and previous KV cache vectors from VRAM into compute registers.',
      bottleneckBandwidth: 'memory bandwidth-bound (VRAM transfer rate).',
      operationGemv: 'matrix-vector multiplication (GEMV). Low arithmetic intensity.',
      metricTpot: 'TPOT (time per output token):',
      formulaTpot: 'TPOT = 1000 / decode speed (ms/token)',
      agenticHeading: 'Why agentic loops require per-turn walltime measurement',
      agenticIntroBefore: 'An AI agent operates in a loop: ',
      loopStages: 'Plan → Tool Call → Tool Execution → Process Result → Next Action',
      agenticIntroAfter: '. With each turn, the conversation context grows because previous tool inputs and outputs are appended to the prompt.',
      withoutCaching: 'Without prefix caching',
      withoutCachingBodyBefore: 'On turn k, the inference server must re-prefill the entire accumulated history P',
      subK: 'k',
      withoutCachingBodyAfter: '. Prefill latency increases linearly/quadratically per turn, causing high turn walltime.',
      withCaching: 'With prefix caching (RadixAttention)',
      withCachingBodyBefore: 'The server reuses existing KV cache blocks for turns 1..k-1. It only prefills the new tool response tokens ΔP',
      withCachingBodyAfter: ', keeping turn walltimes consistently low.',
      faqHeading: 'Community FAQ — speed setups',
      faqIntro: 'Compiled from the questions local-LLM users most often ask on X. Use the tabs above to reproduce each scenario.',
      tryIt: 'Try it in the visualizer',
      faq: [
        {
          q: 'Why is my first token so slow, then the rest are fast?',
          a: 'That is normal. The first token waits for the prefill phase: the whole prompt is processed at once (compute-bound). On a mid GPU that is hundreds of ms. After that, decode runs at one token per step, so it feels fast per token — but every token reads the full model weights from VRAM, which is why decode is bandwidth-bound.'
        },
        {
          q: 'What is a good tok/s for a local model?',
          a: 'It depends on the model size and your memory bandwidth. Rule of thumb: decode speed ≈ usable VRAM bandwidth ÷ model size in bytes. A 24 GB/s-class card with a 4-bit 8B model does roughly 30-60 tok/s. If you are below ~10 tok/s on an 8B, something is off (CPU offload, no GPU layers, wrong build).'
        },
        {
          q: 'Why is decode so much slower than prefill?',
          a: 'Prefill is a big parallel matrix-matrix multiply (GEMM) — perfect for tensor cores. Decode is one matrix-vector multiply (GEMV) per token and is dominated by reading weights + KV cache from VRAM. You cannot fix decode speed with more compute; you need more memory bandwidth or a smaller/faster quantized model.'
        },
        {
          q: 'How much VRAM do I need for model + context?',
          a: 'VRAM ≈ weights + KV cache + ~1-2 GB overhead. Weights: model bytes × quant size (e.g. 70B at Q4 ≈ 35-40 GB). KV cache: use the KV Cache Calculator tab — a dense 70B at 32k context FP16 is about 10 GB, so it often does not fit on 24 GB together with weights. Lower KV precision (FP8/INT4) or a shorter context is the lever.'
        },
        {
          q: 'Why does my context length run out of memory?',
          a: 'Because KV cache grows linearly with context and is allocated for every layer. Long prompts with agents (tool outputs, history) fill it fast. Solutions: quantize the KV cache (--cache-type-k/v q8_0 or q4_0), shorten the system prompt, enable prefix caching, or pick a model with MLA / linear attention (they need far less KV per token).'
        },
        {
          q: 'Does flash attention speed up prefill or decode?',
          a: 'Flash attention mainly accelerates prefill and long-context attention compute, and it reduces memory use. It has little effect on the decode bottleneck (bandwidth-bound GEMV). It can also free VRAM, which indirectly lets you use a bigger context. Benchmark both — the gain is model- and context-dependent.'
        },
        {
          q: 'Is a higher quant always slower?',
          a: 'Usually yes but not by much. Q8 vs Q4 changes decode speed roughly by the bandwidth ratio of the sizes read per token. On a 4090-class card, 70B Q4 vs Q8 can differ 10-30%. Quality also differs: use the largest quant that fits your VRAM budget — Q4_K_M is the common sweet spot.'
        },
        {
          q: 'Why is my Mac / CPU box slower than the GPU numbers I see?',
          a: 'Unified memory and system RAM have far lower bandwidth than GDDR/HBM (e.g. ~100 GB/s vs 1000+ GB/s). Decode speed tracks that bandwidth. Also check the backend actually uses GPU layers (Metal/CUDA) and not CPU fallback, and that you are comparing the same quant and context.'
        }
      ]
    },

    localMaxxing: {
      panelAria: 'LocalMaxxing measured presets',
      title: 'LocalMaxxing measured presets',
      liveRunsTag: 'live community runs',
      introHardwareFirst: 'Hardware first: pick a rig, then a model and quant. Only single-stream measured runs are shown.',
      introModelFirst: 'Pick one model and quant. Only single-stream runs with measured prefill and decode speeds are shown.',
      switchToHardwareTitle: 'Switch to hardware → model → quant',
      switchToModelTitle: 'Switch to model → quant → hardware',
      modelFirst: 'Model first',
      hardwareFirst: 'Hardware first',
      openLeaderboard: 'Open leaderboard',
      modelRepository: 'Model repository',
      loadingModelsPlaceholder: 'Loading models…',
      searchModelPlaceholder: 'Search or enter Hugging Face model ID',
      loadRunsAria: 'Load runs for model',
      loadRunsTooltip: 'Load LocalMaxxing runs for this model',
      runsCountSuffix: 'runs',
      quantization: 'Quantization',
      loadModelFirst: 'Load a model first',
      hardwareRunLabel: 'Hardware run ({count} comparable)',
      selectHardwareOption: 'Select hardware to prefill speeds',
      hardwareCountLabel: 'Hardware ({count} rigs with comparable runs)',
      loadingCommunityRuns: 'Loading community runs…',
      loadingCommunityRunsWithProgress: 'Loading community runs… {rows} runs ({pages} pages)',
      selectHardware: 'Select hardware',
      pickHardwareFirst: 'Pick hardware first',
      selectModel: 'Select model ({count})',
      quantizationRunLabel: 'Quantization / run ({count} comparable)',
      pickModelFirst: 'Pick a model first',
      selectMeasuredRun: 'Select measured run',
      noRunsForModel: 'No single-stream runs contain both prefill and decode measurements for this model.',
      noRunsForPair: 'No single-stream runs pair this model with the selected hardware.',
      selectedPrefix: '{state}: '
    }
  }
};

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

let currentLocale = 'en';

function resolveDict(locale) {
  return locales[locale] || locales.en;
}

function lookup(dict, path) {
  let node = dict;
  for (const part of path.split('.')) {
    if (node === undefined || node === null) return undefined;
    node = node[part];
  }
  return node;
}

function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/**
 * Translate a dotted key, e.g. t('header.presetLabel').
 * Falls back: current locale → English → the key itself.
 */
export function t(key, params) {
  const localized = lookup(resolveDict(currentLocale), key);
  if (localized !== undefined && typeof localized !== 'object') {
    return interpolate(localized, params);
  }
  const fallback = lookup(locales.en, key);
  if (fallback !== undefined && typeof fallback !== 'object') {
    return interpolate(fallback, params);
  }
  return key;
}

/** Array-valued keys (e.g. theory.faq, agentic.turnActions) resolve against the
 *  active locale when complete, otherwise against English. */
export function tArray(key) {
  const localized = lookup(resolveDict(currentLocale), key);
  if (Array.isArray(localized)) return localized;
  const fallback = lookup(locales.en, key);
  return Array.isArray(fallback) ? fallback : [];
}

/** Switch the active locale. Unknown locale codes are ignored. */
export function setLocale(locale) {
  if (locales[locale]) currentLocale = locale;
}

export function getLocale() {
  return currentLocale;
}

/** Layout direction for the active locale ('ltr' | 'rtl'). */
export function getDirection() {
  const base = currentLocale.split('-')[0];
  return RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr';
}
