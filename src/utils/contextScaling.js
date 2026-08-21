// Context-length scaling of decode speed.
//
// Model (simple bandwidth roofline, documented in the issue): decode is
// memory-bandwidth bound — every generated token must stream the model
// weights off VRAM once PLUS the entire KV cache accumulated so far.
// Weight-read time per step is constant; KV-read time grows linearly with
// cached tokens. So time-per-token at cache depth c is:
//
//   tpot(c) = tpot_weights + tpot_kv · c          (linear in cache size)
//
// We parametrize the curve by a single user-facing constant, C½: the context
// depth at which decode speed has halved (i.e. TPOT has doubled). Solving
// tpot(2·C½) = 2·tpot(0) gives tpot_weights = C½ · tpot_kv, so:
//
//   tpot(c) = tpot(0) · (1 + c / C½)
//   speed(c) = base / (1 + c / C½)
//
// Larger C½ = KV reads stay cheap longer (big-BW GPUs, quantized KV,
// GQA/MLA models); smaller C½ = speed falls off a cliff. This collapses the
// physical model into one slider while keeping the linear-in-cache shape.

// Default C½: on typical consumer hardware running a mid-size model with
// fp16 KV, measured decode curves put the half-speed point around ~32K tokens.
export const DEFAULT_HALF_SPEED_CONTEXT = 32768;

// Slider/preset range for C½, in tokens.
export const HALF_SPEED_CONTEXT_PRESETS = [8192, 16384, 32768, 65536, 131072];

function sanitize(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// TPOT multiplier vs an empty cache at cache depth `contextTokens`.
export function tpotMultiplierAt(contextTokens, halfSpeedContext = DEFAULT_HALF_SPEED_CONTEXT) {
  const c = Math.max(0, contextTokens || 0);
  const h = sanitize(halfSpeedContext, DEFAULT_HALF_SPEED_CONTEXT);
  return 1 + c / h;
}

// Instantaneous decode speed (tok/s) when the KV cache holds `contextTokens`.
export function decodeSpeedAtContext(baseDecodeSpeed, contextTokens, halfSpeedContext = DEFAULT_HALF_SPEED_CONTEXT) {
  if (!Number.isFinite(baseDecodeSpeed) || baseDecodeSpeed <= 0) return 0;
  return baseDecodeSpeed / tpotMultiplierAt(contextTokens, halfSpeedContext);
}

// Total decode walltime to generate nTokens tokens on top of a prompt that
// already occupies promptCtx cache slots, under the linear TPOT model.
// Token i (0-indexed) is produced with the cache at depth promptCtx + i:
//
//   t(n) = Σ_{i=0..n-1} tpot0 · (1 + (P + i)/C½)
//        = tpot0 · [ n + (n·P + n·(n-1)/2) / C½ ]
//
// Closed form so the simulation clock stays exact and invertible.
export function scaledDecodeTime(baseDecodeSpeed, promptCtx, nTokens, halfSpeedContext = DEFAULT_HALF_SPEED_CONTEXT) {
  if (!Number.isFinite(baseDecodeSpeed) || baseDecodeSpeed <= 0) return Infinity;
  // Fractional n is allowed: the closed form is continuous, and callers that
  // count whole tokens pass integers anyway.
  const n = Math.max(0, nTokens || 0);
  if (n === 0) return 0;
  const p = Math.max(0, promptCtx || 0);
  const h = sanitize(halfSpeedContext, DEFAULT_HALF_SPEED_CONTEXT);
  const tpot0 = 1 / baseDecodeSpeed;
  return tpot0 * (n + (n * p + (n * (n - 1)) / 2) / h);
}

// Average decode speed over a full generation of nTokens tokens.
export function averageScaledSpeed(baseDecodeSpeed, promptCtx, nTokens, halfSpeedContext = DEFAULT_HALF_SPEED_CONTEXT) {
  const n = Math.max(0, nTokens || 0);
  if (n === 0) return Number.isFinite(baseDecodeSpeed) && baseDecodeSpeed > 0 ? baseDecodeSpeed : 0;
  const t = scaledDecodeTime(baseDecodeSpeed, promptCtx, nTokens, halfSpeedContext);
  return Number.isFinite(t) && t > 0 ? n / t : 0;
}

// Inverse of scaledDecodeTime: how many tokens have been generated after
// `elapsedSec` of decode-phase walltime. Solves the quadratic
//   (tpot0 / (2·C½))·n² + tpot0·(1 + P/C½)·n − t = 0
// for n, falling back to the linear solution as C½ → ∞.
export function tokensGeneratedAt(baseDecodeSpeed, promptCtx, elapsedSec, halfSpeedContext = DEFAULT_HALF_SPEED_CONTEXT) {
  if (!Number.isFinite(baseDecodeSpeed) || baseDecodeSpeed <= 0) return 0;
  const t = Math.max(0, elapsedSec || 0);
  if (t === 0) return 0;
  const p = Math.max(0, promptCtx || 0);
  const h = sanitize(halfSpeedContext, DEFAULT_HALF_SPEED_CONTEXT);
  const tpot0 = 1 / baseDecodeSpeed;
  const b = tpot0 * (1 + p / h);
  const a = tpot0 / (2 * h);
  // Inverting t(n) = tpot0·[n + (n·P + n(n−1)/2)/C½] gives
  //   a·n² + (b − a)·n − t = 0
  // solved with the cancellation-free rational form of the quadratic formula.
  const bl = b - a;
  const n = (2 * t) / (bl + Math.sqrt(bl * bl + 4 * a * t));
  return Math.max(0, n);
}
