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
  [/^q4[_ ]?1?$/, 4.55, 'q4_0'],
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
  // Unknown tag: assume ~4-bit and say so, rather than failing the call.
  return { key: q, bpw: 4.85, bytesPerParam: 4.85 / 8, assumed: true };
}
