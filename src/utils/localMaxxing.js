import { fmtEn } from './numfmt.js';
const API_BASE = '/localmaxxing-api';

function positiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

export function isComparableRun(run) {
  const concurrency = run.engineFlags?.concurrency;
  const numParallel = run.engineFlags?.numParallel;

  return run.batchSize === 1
    && (concurrency == null || concurrency <= 1)
    && (numParallel == null || numParallel <= 1)
    && positiveNumber(run.tokSPrefill)
    && positiveNumber(run.tokSOut);
}

export function hardwareName(run) {
  const hardware = run.hardware || {};
  const count = hardware.gpuCount || 1;

  if (hardware.hwClass === 'DISCRETE_GPU') {
    const memory = hardware.vramGb ? ` ${hardware.vramGb}GB` : '';
    return `${count > 1 ? `${count}× ` : ''}${hardware.gpuName || 'Discrete GPU'}${memory}`;
  }

  if (hardware.hwClass === 'UNIFIED') {
    const chip = hardware.chipVariant || hardware.chipFamily || hardware.chipVendor || 'Unified memory system';
    const memory = hardware.unifiedMemoryGb ? ` ${hardware.unifiedMemoryGb}GB` : '';
    return `${chip}${memory}`;
  }

  return hardware.cpu || 'CPU-only system';
}

export function hardwareKey(run) {
  const hardware = run.hardware || {};
  return [
    hardware.hwClass,
    hardware.gpuName,
    hardware.gpuCount,
    hardware.vramGb,
    hardware.chipVendor,
    hardware.chipFamily,
    hardware.chipVariant,
    hardware.unifiedMemoryGb,
    hardware.cpu,
    run.engine?.engineName
  ].join('|');
}

export function runLabel(run) {
  const engine = run.engine?.engineName || 'unknown engine';
  const age = runAgeDays(run);
  const ageTag = age === null ? '' : ` · ${age < 90 ? 'fresh' : age < 365 ? 'aging' : 'stale'} ${age}d`;
  return `${hardwareName(run)} · ${engine}${ageTag} · ${fmtEn(run.tokSPrefill)} prefill / ${fmtEn(run.tokSOut)} decode tok/s`;
}

// ---------- Freshness (issue #38) ----------
// Tiers match the API contract in api/_freshness.js:
//   fresh <90d · aging <1y · stale ≥1y; null when the run has no usable date.

const FRESH_DAYS = 90;
const AGING_DAYS = 365;

export function runAgeDays(run, now = new Date()) {
  if (!run?.createdAt) return null;
  const created = new Date(run.createdAt);
  if (Number.isNaN(created.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86400000));
}

export function stalenessTier(ageDays) {
  if (!Number.isFinite(ageDays)) return 'unknown';
  if (ageDays < FRESH_DAYS) return 'fresh';
  if (ageDays < AGING_DAYS) return 'aging';
  return 'stale';
}

export function runFreshness(run, now = new Date()) {
  const ageDays = runAgeDays(run, now);
  return { ageDays, tier: stalenessTier(ageDays) };
}

/** True when two measured presets differ enough that their numbers may not be comparable. */
export function methodologyMismatch(presetA, presetB) {
  if (!presetA?.localMaxxing || !presetB?.localMaxxing) return [];
  const reasons = [];
  const runA = presetA.run || {};
  const runB = presetB.run || {};
  const engineA = runA.engine?.engineName;
  const engineB = runB.engine?.engineName;
  if (engineA && engineB && engineA !== engineB) reasons.push(`different engines (${engineA} vs ${engineB})`);
  const tierA = stalenessTier(runAgeDays(runA));
  const tierB = stalenessTier(runAgeDays(runB));
  if (tierA !== tierB) reasons.push(`different data ages (${tierA} vs ${tierB})`);
  else if (tierA === 'stale') reasons.push('both measurements are stale (>1 year old)');
  return reasons;
}

export function getQuantizations(runs) {
  const counts = new Map();
  for (const run of runs) {
    const quant = run.engine?.quantization || 'Unknown';
    counts.set(quant, (counts.get(quant) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([quant]) => quant);
}

export function toLocalPreset(run, now = new Date()) {
  const quant = run.engine?.quantization || 'Unknown quant';
  const engine = run.engine?.engineName || 'Unknown engine';
  const modelName = run.model?.displayName || run.model?.hfId || 'Unknown model';
  const freshness = runFreshness(run, now);

  return {
    id: `lmx:${run.id}`,
    name: `${hardwareName(run)} (${engine} ${quant} · ${fmtEn(run.tokSPrefill)} / ${fmtEn(run.tokSOut)} tok/s)`,
    prefillSpeed: run.tokSPrefill,
    decodeSpeed: run.tokSOut,
    icon: '📊',
    badge: 'LocalMaxxing run',
    vramBandwidth: 'Measured community result',
    description: `${modelName}; ${run.promptTokens || 0} prompt tokens; ${run.outputTokens || 0} output tokens; ${run.contextLength ? fmtEn(run.contextLength) : 'unknown'} context.`,
    sourceUrl: `https://localmaxxing.com/en/runs/${run.id}`,
    localMaxxing: true,
    hardwareKey: hardwareKey(run),
    // Methodology metadata (issue #38): measurement date + staleness tier
    // and engine version, surfaced next to every number derived from it.
    measuredAt: run.createdAt || null,
    ageDays: freshness.ageDays,
    staleness: freshness.tier,
    engineVersion: run.engine?.engineVersion || null,
    run
  };
}

/**
 * Structured provenance for a LocalMaxxing-measured config (#602): lets
 * exports distinguish community-measured speeds from synthetic preset
 * numbers and cite the source run with its staleness caveats.
 * Returns null when the active preset is not an lmx:<runId> one.
 */
export function lmxProvenance(presetId, run) {
  if (!presetId || !presetId.startsWith('lmx:') || !run) return null;
  const ageDays = runAgeDays(run);
  return {
    presetId,
    runId: run.id,
    modelId: run.model?.hfId || null,
    quantization: run.engine?.quantization || null,
    engine: run.engine?.engineName || null,
    engineVersion: run.engine?.engineVersion ?? null,
    measuredAt: run.createdAt || null,
    ageDays,
    staleness: stalenessTier(ageDays),
    sourceUrl: `https://localmaxxing.com/en/runs/${run.id}`,
    kind: 'community-measured'
  };
}

async function fetchJson(path, signal) {
  const response = await fetch(`${API_BASE}${path}`, { signal });
  if (!response.ok) throw new Error(`LocalMaxxing returned ${response.status}`);
  return response.json();
}
export async function fetchModels(signal) {
  const models = await fetchJson('/models?limit=1000', signal);
  return models
    .filter(model => (model._count?.benchmarkRuns || model.speedStats?.total || 0) > 0)
    .sort((a, b) => (b._count?.benchmarkRuns || 0) - (a._count?.benchmarkRuns || 0));
}

export async function fetchComparableRuns(hfId, signal) {
  const params = new URLSearchParams({ hfId, limit: '200' });
  const data = await fetchJson(`/leaderboard?${params.toString()}`, signal);
  return (data.rows || []).filter(isComparableRun);
}
