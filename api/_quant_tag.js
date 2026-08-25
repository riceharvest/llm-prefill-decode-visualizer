// Shared anchored quantization-tag component scanner (#1071).
//
// /api/sizing (`bitsPerWeight`) and /api/best?fitCheck (`quantBitsPerWeight`
// in _vramfit.js) previously matched UNANCHORED regexes (/int?4/, /bf16|f16/)
// anywhere in a composite tag, so one tag like
//   GPTQ-INT4-G64-sym-local+DFlash-BF16-local
// resolved to 4 bpw on one endpoint (its /int?4/ latched onto INT4) and 16 bpw
// on the other (its /bf16/ latched onto BF16) — a 4× weight-size disagreement.
//
// This module locates the weight-storage component BOTH parsers must resolve:
// the earliest tag-order substring that matches any recognized quant family.
// Each endpoint still maps the located component through its OWN constants
// table (#1025's documented per-endpoint drift), so only the parsing
// mechanism is unified — never which substring wins.

const SCANNERS = [
  // MLX-style: '4bit', '8bit' ('4bit-dwq')
  { kind: 'mlx', re: /(?<![a-z0-9])(\d+)bits?(?![a-z0-9])/g },
  // 16-bit float storage: bf16, fp16, f16, half
  { kind: 'f16', re: /(?<![a-z0-9])(bf16|fp16|f16|half)(?![a-z0-9])/g },
  // 8-bit float storage: fp8, f8, e4m3
  { kind: 'f8', re: /(?<![a-z0-9])(fp8|f8|e4m3)(?![a-z0-9])/g },
  // Integer storage: int4/int5/.../int8, i4...
  { kind: 'int', re: /(?<![a-z0-9])((?:int|i)[1-8])(?![a-z0-9])/g },
  // GGUF cluster incl. suffixes: q4, q4_k_m, q4_0, iq3_xxs, q8_0 ...
  { kind: 'gguf', re: /(?<![a-z0-9])(i?q[1-8](?:_[0-9a-z]+)*)(?![a-z0-9])/g }
];

/**
 * Locate the weight-storage component of a (possibly composite) quantization
 * tag: the earliest-position match across all recognized families.
 *
 * @param {string} tag raw quantization label (any case)
 * @returns {{ index: number, text: string, kind: string, bitBase: number|null }|null}
 *   `bitBase` carries the canonical bit width where the syntax encodes it
 *   directly (mlx / int); gguf callers parse `text` themselves for k-quant
 *   effective-rate bumps. null when nothing recognizable exists.
 */
export function locateQuantComponent(tag) {
  if (tag == null) return null;
  const q = String(tag).toLowerCase();
  if (!q) return null;

  let best = null;
  for (const { kind, re } of SCANNERS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(q)) !== null) {
      const index = m.index + m[0].indexOf(m[1]);
      if (!best || index < best.index) {
        best = {
          index,
          text: m[1],
          kind,
          bitBase: kind === 'mlx' ? Number(m[1])
            : kind === 'int' ? Number(m[1].replace(/^[a-z]+/, ''))
            : kind === 'f16' ? 16
            : kind === 'f8' ? 8
            : null
        };
        if (best.index === 0) return best; // can't beat position 0
      }
      break; // one match per scanner is enough — we only need the earliest overall
    }
  }
  return best;
}

/**
 * True when more than one distinct weight-storage component is present, i.e.
 * the endpoints' constant tables are applied to a composite/draft-mixed tag.
 * Exposed so handlers can surface provenance warnings without re-scanning.
 */
export function quantTagIsComposite(tag) {
  const first = locateQuantComponent(tag);
  if (!first) return false;
  const rest = String(tag).toLowerCase().slice(first.index + first.text.length);
  return locateQuantComponent(rest) !== null;
}
