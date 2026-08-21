// Model-name normalization: collapse repo/quant/finetune variants of the same
// base model into one family key.
//
//   "unsloth/Qwen3.6-27B-MTP-GGUF"            → "qwen3-6-27b"
//   "mlx-community/Qwen3.6-35B-A3B-4bit"      → "qwen3-6-35b-a3b"
//   "ggml-org/gemma-4-12B-it-GGUF"            → "gemma-4-12b"
//   "lmstudio-community/NVIDIA-Nemotron-3-Nano-4B-GGUF" → "nvidia-nemotron-3-nano-4b"
//   "bartowski/Llama-3.1-8B-Instruct-i1-GGUF" → "llama-3-1-8b"
//
// Algorithm: tokenize on [-_.], find the first size token (e.g. 27b, 135m,
// 0.5b) after position 0, keep everything up to and including it, plus one
// following MoE active-param token (a3b / e4b / a2.5b) when present. Dots
// inside tokens become dashes so "qwen3.6" → "qwen3-6".

const SIZE_RE = /^[a-z]?\d+(?:\.\d+)?(?:b|m|k)$/;

export function normalizeModelId(hfId) {
  const s = String(hfId || '').split('/').pop().toLowerCase();
  const tokens = s.split(/[-_.]/).filter(Boolean);
  let sizeIdx = -1;
  for (let i = 1; i < tokens.length; i++) {
    if (SIZE_RE.test(tokens[i])) { sizeIdx = i; break; }
  }
  if (sizeIdx === -1) return s;
  const parts = tokens.slice(0, sizeIdx + 1);
  // MoE active-param tag: a following token pair like ["a2","5b"] (from
  // "A2.5B" split on the dot) or a single "a3b"/"a1b" token.
  const n1 = tokens[sizeIdx + 1];
  const n2 = tokens[sizeIdx + 2];
  if (n1 && /^a\d+$/.test(n1) && n2 && /^\d+b$/.test(n2)) {
    parts.push(`${n1}.${n2}`); // rejoin dot-split active-param, e.g. a2.5b
  } else if (n1 && /^a\d+(?:\.\d+)?b$/.test(n1)) {
    parts.push(n1);
  }
  return parts.join('-');
}
