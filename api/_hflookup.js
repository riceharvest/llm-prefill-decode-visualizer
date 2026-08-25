// Offline architecture lookup for common open-weight model families
// (issue #68: hfId-based VRAM estimation without a network round-trip).
//
// /api/vram resolves its resolution in three tiers:
//   1. HF_ARCH_TABLE below — exact family+size match on the model name.
//      Deterministic, zero network. Covers the qwen3*, llama*, gemma* and
//      mistral* families people actually simulate.
//   2. Hugging Face config.json / GGUF header (see _hfconfig.js) — exact for
//      any public repo, but needs huggingface.co to be reachable.
//   3. guessArchFromName — parse the size tag ("8b", "0.6b", "70b") out of the
//      model name and bucket it like _vramfit.guessArchitecture does. Rough,
//      but keeps VRAM estimation working when HF is unreachable or gated.
//
// Table values are transcribed from each repo's published config.json
// (num_hidden_layers / hidden_size / num_attention_heads /
// num_key_value_heads / head_dim / max_position_embeddings and the
// safetensors parameter count). Keep entries specific-first: matchers are
// tested in order against the lowercased hfId.

export const HF_ARCH_TABLE = [
  // ---- Llama 3.x (meta-llama) -------------------------------------------
  {
    pattern: /llama-?3\.2[-_ ]?1b/,
    family: 'llama3.2-1b',
    arch: { numLayers: 16, hiddenSize: 2048, numHeads: 32, kvHeads: 8, headDim: 64, maxContextLength: 131072 },
    paramsTotal: 1_235_814_400
  },
  {
    pattern: /llama-?3\.2[-_ ]?3b/,
    family: 'llama3.2-3b',
    arch: { numLayers: 28, hiddenSize: 3072, numHeads: 24, kvHeads: 8, headDim: 128, maxContextLength: 131072 },
    paramsTotal: 3_214_017_536
  },
  {
    // 3.1 before plain 3: same shape, but 3.1 extended the context window.
    pattern: /llama-?3\.1[-_ ]?8b/,
    family: 'llama3.1-8b',
    arch: { numLayers: 32, hiddenSize: 4096, numHeads: 32, kvHeads: 8, headDim: 128, maxContextLength: 131072 },
    paramsTotal: 8_030_269_440
  },
  {
    pattern: /llama-?3\.1[-_ ]?70b/,
    family: 'llama3.1-70b',
    arch: { numLayers: 80, hiddenSize: 8192, numHeads: 64, kvHeads: 8, headDim: 128, maxContextLength: 131072 },
    paramsTotal: 70_553_710_592
  },
  {
    pattern: /llama-?3[-_ ]?8b/,
    family: 'llama3-8b',
    arch: { numLayers: 32, hiddenSize: 4096, numHeads: 32, kvHeads: 8, headDim: 128, maxContextLength: 8192 },
    paramsTotal: 8_030_269_440
  },

  // ---- Qwen3 (Qwen) -------------------------------------------------------
  {
    pattern: /qwen3[-_ ]?0\.6b/,
    family: 'qwen3-0.6b',
    arch: { numLayers: 28, hiddenSize: 1024, numHeads: 16, kvHeads: 8, headDim: 128, maxContextLength: 40960 },
    paramsTotal: 595_774_464
  },
  {
    pattern: /qwen3[-_ ]?1\.7b/,
    family: 'qwen3-1.7b',
    arch: { numLayers: 28, hiddenSize: 2048, numHeads: 16, kvHeads: 8, headDim: 128, maxContextLength: 40960 },
    paramsTotal: 2_036_339_200
  },
  {
    pattern: /qwen3[-_ ]?4b/,
    family: 'qwen3-4b',
    arch: { numLayers: 36, hiddenSize: 2560, numHeads: 32, kvHeads: 8, headDim: 128, maxContextLength: 40960 },
    paramsTotal: 4_022_470_656
  },
  {
    pattern: /qwen3[-_ ]?8b/,
    family: 'qwen3-8b',
    arch: { numLayers: 36, hiddenSize: 4096, numHeads: 32, kvHeads: 8, headDim: 128, maxContextLength: 40960 },
    paramsTotal: 8_190_729_216
  },
  {
    pattern: /qwen3[-_ ]?14b/,
    family: 'qwen3-14b',
    arch: { numLayers: 40, hiddenSize: 5120, numHeads: 40, kvHeads: 8, headDim: 128, maxContextLength: 40960 },
    paramsTotal: 14_772_767_744
  },
  {
    // MoE variants before their dense-looking size prefixes.
    pattern: /qwen3[-_ ]?30b/,
    family: 'qwen3-30b-a3b (MoE)',
    arch: { numLayers: 48, hiddenSize: 2048, numHeads: 32, kvHeads: 4, headDim: 128, maxContextLength: 40960 },
    paramsTotal: 30_532_121_600
  },
  {
    pattern: /qwen3[-_ ]?32b/,
    family: 'qwen3-32b',
    arch: { numLayers: 64, hiddenSize: 5120, numHeads: 40, kvHeads: 8, headDim: 128, maxContextLength: 40960 },
    paramsTotal: 32_764_386_304
  },
  {
    pattern: /qwen3[-_ ]?235b/,
    family: 'qwen3-235b-a22b (MoE)',
    arch: { numLayers: 94, hiddenSize: 4096, numHeads: 64, kvHeads: 4, headDim: 128, maxContextLength: 40960 },
    paramsTotal: 235_142_981_632
  },

  // ---- Gemma 2/3 (google) --------------------------------------------------
  {
    pattern: /gemma-?[23][-_ ]?1b/,
    family: 'gemma3-1b',
    arch: { numLayers: 26, hiddenSize: 1152, numHeads: 4, kvHeads: 1, headDim: 256, maxContextLength: 32768 },
    paramsTotal: 1_047_573_504
  },
  {
    pattern: /gemma-?2[-_ ]?2b/,
    family: 'gemma2-2b',
    arch: { numLayers: 26, hiddenSize: 2304, numHeads: 8, kvHeads: 4, headDim: 256, maxContextLength: 8192 },
    paramsTotal: 2_614_417_920
  },
  {
    pattern: /gemma-?3[-_ ]?4b/,
    family: 'gemma3-4b (text tower)',
    arch: { numLayers: 34, hiddenSize: 2560, numHeads: 8, kvHeads: 4, headDim: 256, maxContextLength: 131072 },
    paramsTotal: 3_884_539_520
  },
  {
    pattern: /gemma-?2[-_ ]?9b/,
    family: 'gemma2-9b',
    arch: { numLayers: 42, hiddenSize: 3584, numHeads: 16, kvHeads: 8, headDim: 256, maxContextLength: 8192 },
    paramsTotal: 9_242_069_696
  },
  {
    pattern: /gemma-?3[-_ ]?12b/,
    family: 'gemma3-12b (text tower)',
    arch: { numLayers: 48, hiddenSize: 3840, numHeads: 16, kvHeads: 8, headDim: 256, maxContextLength: 131072 },
    paramsTotal: 11_771_547_328
  },
  {
    pattern: /gemma-?2[-_ ]?27b/,
    family: 'gemma2-27b',
    arch: { numLayers: 46, hiddenSize: 4608, numHeads: 32, kvHeads: 16, headDim: 128, maxContextLength: 8192 },
    paramsTotal: 27_652_949_568
  },
  {
    pattern: /gemma-?3[-_ ]?27b/,
    family: 'gemma3-27b (text tower)',
    arch: { numLayers: 62, hiddenSize: 5376, numHeads: 32, kvHeads: 16, headDim: 128, maxContextLength: 131072 },
    paramsTotal: 27_455_183_104
  },

  // ---- Mistral (mistralai) -------------------------------------------------
  {
    pattern: /mistral-?7b/,
    family: 'mistral-7b',
    arch: { numLayers: 32, hiddenSize: 4096, numHeads: 32, kvHeads: 8, headDim: 128, maxContextLength: 32768 },
    paramsTotal: 7_248_084_992
  },
  {
    pattern: /mixtral-?8x7b/,
    family: 'mixtral-8x7b (MoE)',
    arch: { numLayers: 32, hiddenSize: 4096, numHeads: 32, kvHeads: 8, headDim: 128, maxContextLength: 32768 },
    paramsTotal: 46_742_750_208
  },
  {
    pattern: /mistral-?small-?(22|24)b/,
    family: 'mistral-small-24b',
    arch: { numLayers: 40, hiddenSize: 5120, numHeads: 32, kvHeads: 8, headDim: 128, maxContextLength: 32768 },
    paramsTotal: 23_572_106_240
  }
];

/**
 * Tier-1 resolution: exact match of a known family+size in HF_ARCH_TABLE.
 * Returns null when the hfId isn't covered so callers fall through to the
 * Hugging Face network paths.
 */
export function lookupHfArch(hfIdRaw) {
  const hfId = String(hfIdRaw || '').toLowerCase();
  if (!hfId.includes('/')) return null;
  for (const entry of HF_ARCH_TABLE) {
    if (!entry.pattern.test(hfId)) continue;
    return {
      source: 'builtin-table',
      family: entry.family,
      architecture: { ...entry.arch },
      paramsTotal: entry.paramsTotal,
      weightsSource: `built-in ${entry.family} architecture table (${entry.paramsTotal.toLocaleString('en-US')} params)`,
      weightsSourceKind: 'params×quant',
      notes: [`architecture resolved from the built-in lookup table entry '${entry.family}' (offline, no huggingface.co call)`]
    };
  }
  return null;
}

/**
 * Tier-3 fallback: parse the parameter-count tag out of the model name
 * ("Foo-13B-Instruct" → 13B) and bucket it into a plausible architecture the
 * same way _vramfit.guessArchitecture does. Returns null when the name carries
 * no recognizable size tag — we would rather fail loudly than invent numbers
 * with no anchor at all.
 *
 * Documented coarseness: buckets are calibrated on dense Llama/Mistral/Qwen
 * shapes; KV heads assumed GQA with 8 KV heads × 128 head dim; the parameter
 * count itself is the name's claim rounded up, not a measured value.
 */
export function guessArchFromName(hfIdRaw) {
  const name = String(hfIdRaw || '').split('/').pop() || '';
  const lower = name.toLowerCase();

  // MoE ids carry size tags a naive "\d+b" scan misreads as total params
  // (#1073): "8x7b" is experts×expert-size (product ≈ total), and an
  // "a2.7b" tag is ACTIVE params — never the total.
  const moe = lower.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/);
  const active = lower.match(/(?<![a-z0-9])a(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/);

  let paramsB = null;
  let tag = null;
  let activeOnlyLowerBound = false;
  if (moe) {
    paramsB = Number(moe[1]) * Number(moe[2]);
    tag = moe[0];
  } else {
    // Prefer a dense (non-active) size tag: skip candidates whose digits are
    // directly attached to a preceding 'a' ("…a2.7b" = active params).
    const dense = /(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/g;
    let m;
    while ((m = dense.exec(lower))) {
      if (m.index > 0 && lower[m.index - 1] === 'a') continue;
      paramsB = Number(m[1]);
      tag = m[0];
      break;
    }
    if (paramsB == null && active) {
      // Active-only MoE id (e.g. Qwen1.5-MoE-A2.7B): total params are strictly
      // greater than active params, so report the active tag as an explicit
      // LOWER bound and say so in the notes.
      paramsB = Number(active[1]);
      tag = active[0];
      activeOnlyLowerBound = true;
    }
  }

  if (paramsB == null || !Number.isFinite(paramsB) || paramsB <= 0) return null;

  let numLayers = 80;
  if (paramsB <= 10) numLayers = 32;
  else if (paramsB <= 22) numLayers = 48;
  else if (paramsB <= 45) numLayers = 64;

  const weightsSource = moe
    ? `parameter count estimated from the MoE name tag '${tag}' (${moe[1]}×${moe[2]} ≈ ${paramsB}B total; product approximation, not the measured safetensors count)`
    : activeOnlyLowerBound
      ? `parameter count parsed from the model-name ACTIVE-params tag '${tag}' (~${paramsB}B) — LOWER BOUND only: this is a MoE id with no total-size tag, real weights are larger`
      : `parameter count parsed from the model-name tag '${tag}' (~${paramsB}B)`;

  const notes = [
    `huggingface.co could not be reached/used — architecture guessed from the '${tag}' name tag: ${numLayers} layers, 8 KV heads × 128 dim (dense-bucket heuristic). Treat weights AND KV as rough estimates.`,
    'KV-cache math assumes GQA with 8 KV heads and a 128 head dim; models with different attention shapes will drift.'
  ];
  if (moe) notes.unshift(`MoE id detected from name tag '${tag}': params estimated as ${moe[1]} experts × ${moe[2]}B ≈ ${paramsB}B total (approximation).`);
  if (activeOnlyLowerBound) notes.unshift(`MoE id with only an active-params tag ('${tag}'): reported parameter count is a LOWER bound — actual total weights are several times larger.`);

  return {
    source: 'name-heuristic',
    family: null,
    architecture: { numLayers, hiddenSize: null, numHeads: null, kvHeads: 8, headDim: 128, maxContextLength: null },
    paramsTotal: Math.round(paramsB * 1e9),
    weightsSource,
    weightsSourceKind: 'params×quant',
    ...(activeOnlyLowerBound || moe ? { moe: true } : {}),
    notes
  };
}
