// VRAM budget planner helpers (issue #45) — GPU catalog, weight-precision
// presets, and parameter-string parsing for the KV calculator's memory ledger.
// The ledger/verdict math itself lives in api/_math.js (`vramBudget`) so the
// /api surface can share exactly the same numbers.

/** Effective bits-per-weight presets. Q8/Q4 use the same community-effective
 *  rates as api/_vramfit.js (k-quants mix block types, so not exactly n bpw). */
export const WEIGHT_PRECISIONS = [
  { id: 'fp16', label: 'FP16/BF16', bpw: 16 },
  { id: 'q8', label: 'Q8 · ~8.5bpw', bpw: 8.5 },
  { id: 'q4', label: 'Q4 · ~4.5bpw', bpw: 4.5 }
];

/** Common GPUs with their actual (marketing) VRAM, for pass/fail verdicts. */
export const GPU_CATALOG = [
  { id: 'rtx5090', name: 'RTX 5090', vramGb: 32 },
  { id: 'rtx4090', name: 'RTX 4090', vramGb: 24 },
  { id: 'rtx3090', name: 'RTX 3090', vramGb: 24 },
  { id: 'rx7900xtx', name: 'RX 7900 XTX', vramGb: 24 },
  { id: 'rtx5070ti', name: 'RTX 5070 Ti', vramGb: 16 },
  { id: 'rtx4060ti16', name: 'RTX 4060 Ti 16GB', vramGb: 16 },
  { id: 'rtx4060', name: 'RTX 4060', vramGb: 8 },
  { id: 'rtx6000ada', name: 'RTX 6000 Ada', vramGb: 48 },
  { id: 'l40s', name: 'L40S', vramGb: 48 },
  { id: 'a100', name: 'A100 80GB', vramGb: 80 },
  { id: 'h100', name: 'H100 80GB', vramGb: 80 },
  { id: 'h200', name: 'H200 141GB', vramGb: 141 },
  // #609: entries below used to exist ONLY as ledger chips (the old local
  // GPU_PRESETS list), so ?gpu= share links and chip clicks could not resolve
  // against the planner catalog — one selection left the other surface stale.
  { id: 'rtx3060', name: 'RTX 3060', vramGb: 12 },
  { id: 'dual3090', name: 'Dual RTX 3090', vramGb: 48, multiGpu: true },
  { id: 'm3ultra', name: 'Mac Studio M3 Ultra', vramGb: 192, unified: true },
  { id: 'm4max128', name: 'Apple M4 Max · 128 GB unified', vramGb: 128, unified: true },
  { id: 'm2ultra192', name: 'Apple M2 Ultra · 192 GB unified', vramGb: 192, unified: true }
];

/**
 * Legacy ledger-chip ids that predate the shared catalog (#609). Old share
 * links carrying them keep resolving instead of silently falling back to the
 * default GPU while the other surface shows a different rig.
 */
export const LEGACY_GPU_ID_ALIASES = {
  a10080: 'a100'
};

/** Canonicalize a ?gpu= id through the legacy alias table. */
export function normalizeGpuId(id) {
  const key = String(id || '');
  return LEGACY_GPU_ID_ALIASES[key] ?? key;
}

export function gpuById(id) {
  return GPU_CATALOG.find(g => g.id === id) || null;
}

/**
 * Parse a preset's params tag ('70B', '2.8T', '27B') into billions of
 * parameters. Returns null when unparseable.
 */
export function parseParamsB(paramsStr) {
  if (!paramsStr) return null;
  const m = String(paramsStr).trim().match(/^([\d.]+)\s*([tTbBmM]?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  if (unit === 't') return n * 1000;
  if (unit === 'k') return n / 1000;
  return n; // 'B' or bare number
}

/** Weights size in GiB for a parameter count at an effective bpw. */
export function weightsGiB(paramsB, bitsPerWeight) {
  if (!Number.isFinite(paramsB) || !Number.isFinite(bitsPerWeight)) return null;
  return (paramsB * 1e9 * bitsPerWeight) / 8 / (1024 ** 3);
}
