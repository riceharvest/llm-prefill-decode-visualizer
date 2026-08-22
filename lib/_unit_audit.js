// Unit-consistency audits for community benchmark runs (issue #43).
//
// Community data routinely contains speeds reported in the wrong unit
// (ms/token pasted as tok/s), inverted prefill/decode columns, or magnitudes
// that no memory-bandwidth roofline can explain. This module is a reusable,
// pure validator: given one run (or an array of runs) it flags suspicious
// magnitudes without rejecting them — callers decide whether to hard-reject
// (submission ingest already enforces looser sanity bounds) or annotate.
//
// Flagged conditions:
//   decode_above_roofline  — decode tok/s exceeds a plausible per-hwClass
//                            memory-bandwidth roofline (scaled by gpuCount).
//   decode_below_floor     — decode so slow it is probably ms/token misread
//                            as tok/s.
//   prefill_below_floor    — e.g. 'prefill 5 tok/s on an H100?' — compute is
//                            never that slow on discrete hardware.
//   prefill_below_decode   — single-stream decode cannot exceed prefill;
//                            columns are swapped or units are mixed.

// Plausible single-stream decode ceilings (tok/s per GPU/chip). Decode is
// memory-bandwidth bound; multi-GPU rigs scale roughly with aggregate
// bandwidth, so the ceiling is multiplied by gpuCount. Generous by design —
// MoE models on flagship parts get close to these.
const DECODE_ROOFLINE_TOK_S = {
  discrete_gpu: 400,
  unified: 200,
  cpu_only: 50,
  _default: 400
};

// Floors below which the number is almost certainly a unit error rather than
// a genuinely slow rig.
const DECODE_FLOOR_TOK_S = {
  discrete_gpu: 0.2,
  unified: 0.2,
  cpu_only: 0.05,
  _default: 0.2
};

const PREFILL_FLOOR_TOK_S = {
  discrete_gpu: 10,
  unified: 5,
  cpu_only: 1,
  _default: 5
};

function thresholdFor(table, hwClass) {
  return table[String(hwClass || '').toLowerCase()] ?? table._default;
}

/**
 * Audit one run for unit-consistency problems.
 * Accepts any object with { hwClass, gpuCount, prefillTokPerSec, decodeTokPerSec };
 * missing/blank fields are ignored, not flagged.
 * Returns { ok, flags } where each flag is
 *   { code, severity, field, observed, limit, message }.
 */
export function auditRun(run) {
  const flags = [];
  if (!run || typeof run !== 'object') return { ok: true, flags };

  const hwClass = String(run.hwClass || '').toLowerCase() || null;
  const hwLabel = hwClass ? `hwClass '${hwClass}'` : 'unknown hardware class';
  const gpuCountRaw = Number(run.gpuCount);
  const gpuCount = Number.isFinite(gpuCountRaw) && gpuCountRaw >= 1 ? Math.floor(gpuCountRaw) : 1;
  const prefill = Number(run.prefillTokPerSec);
  const decode = Number(run.decodeTokPerSec);

  if (Number.isFinite(decode) && decode > 0) {
    const roofline = thresholdFor(DECODE_ROOFLINE_TOK_S, hwClass) * gpuCount;
    if (decode > roofline) {
      flags.push({
        code: 'decode_above_roofline',
        severity: 'error',
        field: 'decodeTokPerSec',
        observed: decode,
        limit: roofline,
        message: `decode ${decode} tok/s exceeds the plausible memory-bandwidth roofline (${roofline} tok/s for ${hwLabel}${gpuCount > 1 ? ` × ${gpuCount} GPUs` : ''}) — check units`
      });
    }
    const floor = thresholdFor(DECODE_FLOOR_TOK_S, hwClass);
    if (decode < floor) {
      flags.push({
        code: 'decode_below_floor',
        severity: 'warning',
        field: 'decodeTokPerSec',
        observed: decode,
        limit: floor,
        message: `decode ${decode} tok/s is below the plausible floor (${floor} tok/s for ${hwLabel}) — likely ms/token reported as tok/s`
      });
    }
  }

  if (Number.isFinite(prefill) && prefill > 0) {
    const floor = thresholdFor(PREFILL_FLOOR_TOK_S, hwClass);
    if (prefill < floor) {
      flags.push({
        code: 'prefill_below_floor',
        severity: 'warning',
        field: 'prefillTokPerSec',
        observed: prefill,
        limit: floor,
        message: `prefill ${prefill} tok/s is implausibly slow for ${hwLabel} (floor ${floor} tok/s) — check units or measurement method`
      });
    }
  }

  if (Number.isFinite(prefill) && Number.isFinite(decode)
    && prefill > 0 && decode > 0 && decode > prefill) {
    flags.push({
      code: 'prefill_below_decode',
      severity: 'error',
      field: 'decodeTokPerSec',
      observed: decode,
      limit: prefill,
      message: `decode ${decode} tok/s exceeds prefill ${prefill} tok/s for the same config — impossible in single-stream inference; columns swapped or units mixed`
    });
  }

  return { ok: flags.length === 0, flags };
}

/**
 * Audit an array of runs and return a compact summary:
 *   { ok, runsAudited, flaggedRuns, flagCounts, flagged }
 * `flagged` carries one entry per bad run with runId + full flag objects,
 * so submission reviewers see the detail while aggregate payloads can
 * project it down to codes.
 */
export function auditRuns(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const flagged = [];
  const flagCounts = {};
  for (const run of list) {
    const audit = auditRun(run);
    if (audit.ok) continue;
    flagged.push({ runId: run.runId ?? null, hardware: run.hardware ?? run.hardwareKey ?? null, flags: audit.flags });
    for (const f of audit.flags) flagCounts[f.code] = (flagCounts[f.code] || 0) + 1;
  }
  return {
    ok: flagged.length === 0,
    runsAudited: list.length,
    flaggedRuns: flagged.length,
    flagCounts,
    flagged
  };
}

/**
 * Group-level data-quality block for benchmark responses: same summary shape
 * as auditRuns but with `flagged` reduced to { runId, codes } to keep the
 * per-row payload small, plus a status string for quick rendering.
 */
export function dataQuality(runs) {
  const summary = auditRuns(runs);
  return {
    status: summary.ok ? 'ok' : 'flagged',
    runsAudited: summary.runsAudited,
    flaggedRuns: summary.flaggedRuns,
    flagCounts: summary.flagCounts,
    flagged: summary.flagged.map(f => ({ runId: f.runId, codes: f.flags.map(x => x.code) }))
  };
}
