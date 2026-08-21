// Context-length banding (issue #39): measured tok/s depends heavily on the
// context length a run was measured at (long prompts stress prefill and KV
// cache), so comparing a <1k-context run against a 32k+-context run as if
// they were comparable is misleading.
//
// Every run is bucketed into one of four bands via its `contextLength` field:
//   lt1k    contextLength < 1,000
//   1k-8k   1,000 ..< 8,000
//   8k-32k  8,000 ..< 32,000
//   32k+    >= 32,000
// Runs without a finite contextLength band to `null` ("unknown") and are
// never silently merged into a band — comparisons annotate the mix instead.

import { ApiError } from './_errors.js';

/** Ordered low → high; first band whose max bound exceeds the length wins. */
export const CONTEXT_BANDS = [
  { id: 'lt1k', label: '<1k', min: 0, max: 1000 },
  { id: '1k-8k', label: '1k–8k', min: 1000, max: 8000 },
  { id: '8k-32k', label: '8k–32k', min: 8000, max: 32000 },
  { id: '32k+', label: '32k+', min: 32000, max: Infinity }
];

export const CONTEXT_BAND_IDS = CONTEXT_BANDS.map(b => b.id);

/** Band object for a numeric contextLength, or null when unknown/invalid. */
export function contextBandOf(contextLength) {
  const n = Number(contextLength);
  if (!Number.isFinite(n) || n <= 0) return null;
  return CONTEXT_BANDS.find(b => n >= b.min && n < b.max) ?? null;
}

/**
 * Parse a `context_band` query param into a canonical band id.
 * Accepts the ids plus their display labels ('<1k', '1k–8k', …).
 * Returns null for absent/empty values; throws INVALID_PARAMS for anything
 * else so typos fail loudly instead of silently matching nothing.
 */
export function parseContextBandParam(value) {
  if (value == null || value === '') return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  const band = CONTEXT_BANDS.find(b => b.id.toLowerCase() === v || b.label.toLowerCase() === v);
  if (!band) {
    throw new ApiError('INVALID_PARAMS',
      `Unknown context_band "${value}". Valid bands: ${CONTEXT_BAND_IDS.join(', ')}`);
  }
  return band.id;
}

/** Keep only runs measured inside the given band id. Unknowns are dropped. */
export function filterByContextBand(runs, bandId) {
  if (!bandId) return runs;
  return runs.filter(r => r.contextBand === bandId);
}

/**
 * Band mix over a set of runs: per-band run counts (known bands only),
 * how many runs carry no usable contextLength, whether more than one
 * known band is present (`mixed`) and the distinct bands seen.
 */
export function contextBandMix(runs) {
  const counts = new Map();
  let unknown = 0;
  for (const r of runs) {
    if (r.contextBand) counts.set(r.contextBand, (counts.get(r.contextBand) || 0) + 1);
    else unknown++;
  }
  const bands = CONTEXT_BANDS
    .filter(b => counts.has(b.id))
    .map(b => ({ band: b.id, label: b.label, runs: counts.get(b.id) }));
  return {
    bands,
    unknownRuns: unknown,
    distinctBands: bands.length,
    mixed: bands.length > 1
  };
}
