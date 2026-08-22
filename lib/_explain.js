// Pure one-sentence explanation builder for ranked recommendations (#73).
//
// Combines VRAM-fit math (see _vramfit.js / sizing's vramFit block) with the
// measured source into a single human-readable string that agents can pass
// straight through to end users, e.g.:
//
//   '24GB fits 8B q4_k_m weights ~5GB + 32k KV ~4GB with 14GB headroom;
//    measured 100 tok/s decode from run #a1'
//
// The weight/KV figures are ESTIMATES from heuristic fit math (assumed
// architecture + bits-per-weight), never measurements — only the tok/s
// figure is measured data.

const r0 = x => (Number.isFinite(x) ? Math.round(x) : null);
const r1 = x => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/** 32768 → '32k'; 8192 → '8k'; 512 → '512'; junk → null. */
function ctxLabel(contextLength) {
  if (!Number.isFinite(contextLength) || contextLength <= 0) return null;
  const n = Math.round(contextLength);
  return n >= 1024 ? `${Math.round(n / 1024)}k` : String(n);
}

/**
 * Build the explanation sentence. Returns null when there is nothing
 * meaningful to say (no assessable memory, no model size, no measurement).
 */
export function explainRecommendation({
  memoryGb,
  paramsB,
  quantization,
  contextLength = 32768,
  fit, // { fits, estimatedWeightsGb, estimatedKvCacheGb, headroomGb } | null
  decodeTokPerSec,
  runId,
  runsInGroup
} = {}) {
  const mem = r0(memoryGb);
  const subject =
    [Number.isFinite(paramsB) && paramsB > 0 ? `${r1(paramsB)}B` : null, quantization || null]
      .filter(Boolean)
      .join(' ') || 'the model';
  const ctx = ctxLabel(contextLength);

  let fitClause = null;
  if (fit && mem != null && Number.isFinite(fit.estimatedWeightsGb)) {
    const w = r0(fit.estimatedWeightsGb);
    const kvRaw = fit.estimatedKvCacheGb;
    const kv = kvRaw == null || !Number.isFinite(kvRaw) ? null : kvRaw < 1 ? '<1' : String(Math.round(kvRaw));
    const kvPart = kv != null && ctx ? ` + ${ctx} KV ~${kv}GB` : '';
    if (fit.fits) {
      const headroom = r0(fit.headroomGb);
      fitClause =
        `${mem}GB fits ${subject} weights ~${w}GB${kvPart}` +
        (headroom != null && headroom > 0 ? ` with ${headroom}GB headroom` : '');
    } else {
      const short = Number.isFinite(fit.headroomGb) ? Math.ceil(-fit.headroomGb) : null;
      fitClause =
        `${mem}GB cannot fit ${subject} weights ~${w}GB${kvPart}` +
        (short != null && short > 0 ? ` (short ${short}GB)` : '');
    }
  } else if (mem != null && ((Number.isFinite(paramsB) && paramsB > 0) || quantization)) {
    // Fit not assessable (cpu_only, unknown memory, …) — still name rig vs model.
    fitClause = `${subject} on ${mem}GB`;
  }

  let measuredClause = null;
  const speed = r1(decodeTokPerSec);
  if (speed != null) {
    measuredClause =
      runId != null
        ? `measured ${speed} tok/s decode from run #${runId}`
        : `median ${speed} tok/s decode across ${Number.isFinite(runsInGroup) ? runsInGroup : '?'} runs`;
  } else if (Number.isFinite(runsInGroup)) {
    measuredClause = `no measured decode speed on file (${runsInGroup} runs)`;
  }

  if (!fitClause && !measuredClause) return null;
  return [fitClause, measuredClause].filter(Boolean).join('; ');
}
