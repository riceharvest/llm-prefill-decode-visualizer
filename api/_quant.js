// Quantization lookup: map common quant tags (GGUF, GPTQ, AWQ, plain dtypes)
// to approximate bits-per-weight so weight VRAM can be estimated from a bare
// quant string. Values are the widely-cited llama.cpp/GPTQ averages including
// scales/embedding overhead — close enough for "will this rig OOM?" math.

const QUANT_TABLE = [
  // [match regex, bits per weight, canonical name]
  [/^fp32|^f32|^float32$/, 32, 'fp32'],
  [/^fp16$|^f16$|^bf16$|^float16$|^bfloat16$/, 16, 'fp16'],
  [/^fp8$|^f8$|^e4m3$|^e5m2$/, 8, 'fp8'],
  [/^int8$|^q8_?0?$|^q8$/, 8.5, 'q8_0'],
  [/^q6[_ ]?k?$|^iq6/, 6.59, 'q6_k'],
  [/^q5[_ ]?k/, 5.67, 'q5_k_m'],
  [/^q5[_ ]?[01]?$/, 5.54, 'q5_0'],
  [/^q4[_ ]?k/, 4.85, 'q4_k_m'],
  // #882: the old single row `/^q4[_ ]?1?$/` could never match `q4_0` (the
  // `[_ ]?` consumed the separator and the trailing `0` failed `$`), so the
  // advertised q4_0 tag fell through to "unknown" at Q4_K_M's bpw while q4_1
  // resolved under q4_0's canonical name. One row per digit keeps the
  // canonical key equal to the digit the caller actually sent.
  [/^q4[_ ]?0?$|^q4$/, 4.55, 'q4_0'],
  [/^q4[_ ]?1$/, 4.55, 'q4_1'],
  [/^iq4/, 4.5, 'iq4_nl'],
  [/^q3[_ ]?k?_?l?$/, 4.27, 'q3_k_l'],
  [/^q3[_ ]?k?_?m?$|^q3[_ ]?0?$/, 3.91, 'q3_k_m'],
  [/^q3[_ ]?k?_?s?$|^iq3/, 3.5, 'q3_k_s'],
  [/^q2[_ ]?k?$|^iq2/, 3.35, 'q2_k']
];

// Order matters: check longer/specific tags (q4_k) before bare (q4). The
// table above is written so the first match wins.
export function resolveQuant(quant) {
  const q = String(quant || '').toLowerCase().trim();
  if (!q) return { key: 'q4_k_m', bpw: 4.85, bytesPerParam: 4.85 / 8, assumed: false };
  for (const [re, bpw, key] of QUANT_TABLE) {
    if (re.test(q)) {
      return { key, bpw, bytesPerParam: bpw / 8, assumed: false };
    }
  }
  // Unknown tag: assume Q4_K_M's ~4.85 bpw and say so via `assumed`, rather
  // than failing the call. Note the value equals a known tag's — callers must
  // check `assumed`/quantAssumed to tell them apart.
  return { key: q, bpw: 4.85, bytesPerParam: 4.85 / 8, assumed: true };
}

// Machine-readable quant vocabulary (#882): the canonical tags with dedicated
// table rows, in table order. Surfaced via /api/spec (?quant= enum), the MCP
// manifest and the bare /api/compute capability catalog so agents can learn
// the accepted values from the API instead of reading source. This is not a
// strict whitelist — any other string is still accepted and flagged as
// assumed (see resolveQuant) — but these are the tags that resolve exactly.
export const QUANT_ENUM = [...new Set(QUANT_TABLE.map(([, , key]) => key))];

export const QUANT_CATALOG = QUANT_TABLE.map(([, bpw, key]) => ({
  tag: key,
  bitsPerWeight: bpw,
  bytesPerParam: Math.round((bpw / 8) * 10000) / 10000
}));
