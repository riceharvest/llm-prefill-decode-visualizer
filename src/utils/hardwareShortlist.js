// Hardware shortlist ("find me hardware") engine.
//
// Given workload constraints — minimum acceptable decode tok/s at a
// quantization, and a max VRAM budget — produce a ranked shortlist of
// community-measured rigs. Primary source is /api/best (+ /api/localmaxxing
// for raw-run counts); when those serverless endpoints aren't reachable
// (e.g. `vite dev`), it falls back to computing identical median-ranked
// groups client-side from the full comparable-run index.

import { fetchAllComparableRuns } from './hardwareFirst.js';

/** Discrete VRAM if known, otherwise unified memory size. Null when unknown.
 *  Mirrors effectiveVramGb() in api/best.js. */
export function effectiveVramGb(entry) {
  if (Number.isFinite(entry.vramGb)) return entry.vramGb;
  if (Number.isFinite(entry.unifiedMemoryGb)) return entry.unifiedMemoryGb;
  return null;
}

function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Quantization filter match (#817): case-insensitive on BOTH sides, parity
 * with /api/best?quant= which lowercases row + query before comparing.
 * A share link carrying 'q4_k_m' must not silently empty the shortlist
 * while the JSON path accepts the same string.
 */
export function quantizationMatches(rowQuant, quant) {
  if (!quant) return true;
  return String(rowQuant || '').toLowerCase() === String(quant).toLowerCase();
}

/**
 * Build the shortlist from raw comparable runs (same shape as the flattened
 * rows behind /api/localmaxxing). Groups by hardware rig × model family,
 * ranks by median decode so one lucky run doesn't top the chart, and keeps
 * every group that satisfies the constraints.
 */
export function buildShortlist(runs, { minDecode = 0, quant = '', maxVramGb = Infinity, model = '', limit = 20 } = {}) {
  const minD = Number(minDecode) || 0;
  const maxV = Number.isFinite(Number(maxVramGb)) && maxVramGb !== '' ? Number(maxVramGb) : Infinity;
  const q = quant ? String(quant).toLowerCase() : '';
  const m = model ? String(model).toLowerCase() : '';

  const eligible = runs.filter(r =>
    r.decodeTokPerSec >= minD
    && (!q || r.quantization?.toLowerCase() === q)
    && (!m || r.modelFamily?.toLowerCase().includes(m) || r.modelId?.toLowerCase().includes(m))
  );

  const groups = new Map();
  for (const run of eligible) {
    if (!run.hardwareKey) continue;
    const vram = effectiveVramGb(run);
    if (vram == null || vram > maxV) continue;
    const k = `${run.hardwareKey}|${run.modelFamily}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(run);
  }

  return [...groups.values()]
    .map(group => {
      // Representative run: fastest decode, so the source link shows the best
      // verified result for this rig × model pair.
      const best = group.reduce((b, r) => (r.decodeTokPerSec > b.decodeTokPerSec ? r : b), group[0]);
      return {
        hardware: best.hardware,
        hardwareKey: best.hardwareKey,
        hwClass: best.hwClass,
        gpu: best.gpu,
        gpuCount: best.gpuCount,
        vramGb: best.vramGb,
        chip: best.chip,
        unifiedMemoryGb: best.unifiedMemoryGb,
        cpu: best.cpu,
        modelFamily: best.modelFamily,
        exampleModel: best.modelName,
        quantization: best.quantization,
        engine: best.engine,
        runsInGroup: group.length,
        medianDecodeTokPerSec: Math.round(median(group.map(r => r.decodeTokPerSec).sort((a, b) => a - b))),
        medianPrefillTokPerSec: Math.round(median(group.map(r => r.prefillTokPerSec).sort((a, b) => a - b))),
        bestDecodeTokPerSec: best.decodeTokPerSec,
        effectiveVramGb: effectiveVramGb(best),
        source: `https://localmaxxing.com/en/runs/${best.runId}`
      };
    })
    .sort((a, b) => b.medianDecodeTokPerSec - a.medianDecodeTokPerSec)
    .slice(0, limit);
}

async function fetchJson(path, signal) {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json();
}

/**
 * Query the ranked-shortlist endpoints. Tries /api/best with constraint
 * params; enriches each ranked entry with a verified-run count from
 * /api/localmaxxing. If the serverless endpoints aren't available, falls
 * back to client-side aggregation over the full run index.
 *
 * Returns { results, matchedRuns, source: 'api' | 'client' }.
 */
export async function fetchHardwareShortlist(filters, signal) {
  const params = new URLSearchParams({ by: 'decode', limit: '50' });
  if (filters.minDecode) params.set('minDecode', String(filters.minDecode));
  if (filters.quant) params.set('quant', filters.quant);
  if (filters.maxVramGb) params.set('maxVramGb', String(filters.maxVramGb));
  if (filters.model) params.set('model', filters.model);

  try {
    const [best, raw] = await Promise.all([
      fetchJson(`/api/best?${params.toString()}`, signal),
      fetchJson(`/api/localmaxxing?${new URLSearchParams({
        ...(filters.quant ? { quant: filters.quant } : {}),
        limit: '500'
      }).toString()}`, signal)
    ]);

    const runCounts = new Map();
    for (const r of raw.runs || []) {
      const vram = effectiveVramGb(r);
      if (filters.maxVramGb && (vram == null || vram > Number(filters.maxVramGb))) continue;
      const k = `${r.hardwareKey}|${r.modelFamily}`;
      runCounts.set(k, (runCounts.get(k) || 0) + 1);
    }

    const results = (best.results || []).map(entry => ({
      ...entry,
      runsInGroup: runCounts.get(`${entry.hardwareKey}|${entry.modelFamily}`) || entry.runsInGroup
    }));
    return { results, matchedRuns: best.matchedRuns ?? results.length, source: 'api' };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Serverless endpoints unreachable (local dev) — compute client-side.
    const runs = await fetchAllComparableRuns(signal);
    return {
      results: buildShortlist(runs, { ...filters, limit: 50 }),
      matchedRuns: runs.length,
      source: 'client'
    };
  }
}
