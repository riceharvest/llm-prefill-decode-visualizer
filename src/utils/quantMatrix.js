// Quantization tradeoff matrix logic (issue #47).
//
// Pure helpers behind the QuantTradeoffMatrix panel: collapse
// /api/benchmarks?groupBy=quant rows (hardware×quant cohorts) into one row per
// quantization tag, and derive the clearly-labeled estimates — approximate
// bits-per-weight from the quant tag, weights-only VRAM from the family's
// parameter count, and a rough quality-proxy tier.

import { resolveQuant } from '../../api/_quant.js';

// Quality proxy: community rules of thumb keyed on bits-per-weight. Deliberately
// rough — real quality depends on model, task and quant implementation.
const QUALITY_TIERS = [
  [14, 'quant.qualityNearLossless'],
  [7, 'quant.qualityMinor'],
  [4.5, 'quant.qualitySweetSpot'],
  [0, 'quant.qualityNoticeable']
];

export function qualityNoteKey(bpw) {
  for (const [min, key] of QUALITY_TIERS) {
    if (bpw >= min) return key;
  }
  return QUALITY_TIERS[QUALITY_TIERS.length - 1][1];
}

// Rough parameter count from a model family key ("llama-3-1-8b" → 8,
// "qwen3-6-35b-a3b" → 35). Null when the family carries no size token.
export function paramsBillion(family) {
  const m = /(\d+(?:\.\d+)?)b/.exec(String(family || '').toLowerCase());
  return m ? Number(m[1]) : null;
}

function medianSorted(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Weights-only GB: parameter count × bits-per-weight ÷ 8. Null when unknown. */
export function weightsVramGb(family, bpw) {
  const paramsB = paramsBillion(family);
  if (!paramsB || !Number.isFinite(bpw)) return null;
  return Math.round((paramsB * bpw) / 8 * 10) / 10;
}

/**
 * Collapse /api/benchmarks?groupBy=quant groups into one row per quant tag.
 * Each group is a hardware×quant cohort for the queried model family, so a
 * row aggregates every rig measured at that quantization: median-of-medians
 * decode across rigs plus the single best measured cohort/run.
 */
export function buildQuantRows(groups) {
  const byQuant = new Map();
  for (const g of groups || []) {
    // Group keys are `${hardwareKey}|${quant}` and hardwareKey itself contains
    // pipes — prefer bestRun's explicit quantization, fall back to last segment.
    const quant = g.bestRun?.quantization || String(g.key || '').split('|').pop() || 'Unknown';
    // Case-insensitive merge ("fp16" and "FP16" are the same format); the
    // displayed tag is the most common original casing in the cohort.
    const norm = String(quant).toLowerCase();
    if (!byQuant.has(norm)) {
      byQuant.set(norm, { quant, casings: new Map(), cohorts: [] });
    }
    const entry = byQuant.get(norm);
    entry.casings.set(quant, (entry.casings.get(quant) || 0) + 1);
    entry.cohorts.push(g);
  }

  const rows = [...byQuant.values()].map(({ casings, cohorts }) => {
    const display = [...casings.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const resolved = resolveQuant(display);
    const medians = cohorts.map(g => g.decode?.median).filter(Number.isFinite).sort((a, b) => a - b);
    const runs = cohorts.reduce((sum, g) => sum + (g.runs || 0), 0);
    const best = cohorts.reduce((b, g) => ((g.decode?.median || 0) > (b.decode?.median || 0) ? g : b), cohorts[0]);
    return {
      quant: display,
      bpw: resolved.bpw,
      bpwAssumed: resolved.assumed,
      rigs: cohorts.length,
      runs,
      mixedEngines: cohorts.some(g => g.mixedEngines),
      confidenceGrade: best.confidence?.grade || null,
      medianDecode: Math.round(medianSorted(medians) || 0),
      ciLabel: best.decode?.label || null,
      best
    };
  });

  // Highest fidelity first (FP16 at the top, aggressive quants at the bottom).
  return rows.sort((a, b) => b.bpw - a.bpw || a.quant.localeCompare(b.quant));
}
