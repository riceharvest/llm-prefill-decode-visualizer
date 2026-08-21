// Inter-token latency (ITL) percentile simulation (#56).
//
// A single average TPOT hides the jitter that ruins streaming UX: batched
// neighbours, preemption, and KV-cache misses produce a heavy right tail that
// the mean smooths away. This module draws per-token latencies from a
// deterministic seeded distribution, then summarizes them the way benchmark
// reports do — p50 / p95 / p99 plus a histogram.
//
// Model: lognormal jitter. For a target coefficient of variation cv,
//   σ² = ln(1 + cv²),  ITL = base × exp(σ·Z − σ²/2)
// The −σ²/2 correction keeps the *mean* exactly at base, so the reported
// average TPOT is unchanged and only the tail grows with the slider — the
// p99/mean ratio is the story the histogram tells.

// Small, fast, seedable PRNG (mulberry32) — same seed ⇒ same run, so the
// histogram is stable across re-renders and shareable via the seed URL param.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller standard normal from a uniform generator.
function standardNormal(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Draw `count` per-token latencies in ms around `baseMs` with coefficient of
// variation `cv` (0 = perfectly uniform). Deterministic for a given seed.
// Returns an array in generation order (index = token position).
export function drawItlSamples({ baseMs, cv, count, seed = 1 }) {
  const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 0;
  const n = Math.max(0, Math.floor(count) || 0);
  if (n === 0) return [];
  const c = Number.isFinite(cv) ? Math.max(0, cv) : 0;
  const sigma = Math.sqrt(Math.log(1 + c * c));
  const shift = (sigma * sigma) / 2;
  const rng = makeRng(seed);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = base * Math.exp(sigma * standardNormal(rng) - shift);
  }
  return out;
}

// Percentile with linear interpolation between order statistics (numpy's
// default 'linear' method), so p50 of an even-count array is the true median.
// `samples` must be sorted ascending.
export function percentileSorted(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const clamped = Math.min(100, Math.max(0, p));
  const rank = (clamped / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

// Mean, p50/p95/p99 and extremes of an unsorted sample array, in ms.
export function summarizeItl(samples) {
  const n = samples.length;
  if (n === 0) {
    return { mean: NaN, p50: NaN, p95: NaN, p99: NaN, min: NaN, max: NaN, count: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  let sum = 0;
  for (const s of samples) sum += s;
  return {
    mean: sum / n,
    p50: percentileSorted(sorted, 50),
    p95: percentileSorted(sorted, 95),
    p99: percentileSorted(sorted, 99),
    min: sorted[0],
    max: sorted[n - 1],
    count: n
  };
}

// Fixed-width histogram over the sample range. Returns { bins, min, max } with
// `bins` entries of { from, to, count }; the last bin is closed on the max so
// no sample falls off the right edge.
export function histogramItl(samples, binCount = 28) {
  const n = samples.length;
  const bins = Math.max(1, Math.floor(binCount) || 1);
  if (n === 0) return { bins: [], min: NaN, max: NaN };
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  if (max === min) {
    return { bins: [{ from: min, to: max, count: n }], min, max };
  }
  const width = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const s of samples) {
    let idx = Math.floor((s - min) / width);
    if (idx >= bins) idx = bins - 1; // right-closed final bin
    if (idx < 0) idx = 0;
    counts[idx] += 1;
  }
  return {
    bins: counts.map((count, i) => ({ from: min + i * width, to: min + (i + 1) * width, count })),
    min,
    max
  };
}

// Cumulative arrival times (ms) of each token: schedule[i] = time at which
// token i+1 appears, relative to the start of decode. Powers the jittered
// decode animation — token n is visible once elapsed-decode-time ≥ schedule[n].
export function cumulativeItlSchedule(samples) {
  const out = new Array(samples.length);
  let acc = 0;
  for (let i = 0; i < samples.length; i++) {
    acc += samples[i];
    out[i] = acc;
  }
  return out;
}

// Number of tokens emitted by `elapsedMs` into a cumulative schedule
// (binary search — the schedule is strictly increasing).
export function tokensEmittedBy(schedule, elapsedMs) {
  let lo = 0;
  let hi = schedule.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (schedule[mid] <= elapsedMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
