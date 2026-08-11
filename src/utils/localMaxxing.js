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
  return `${hardwareName(run)} · ${engine} · ${run.tokSPrefill.toLocaleString()} prefill / ${run.tokSOut.toLocaleString()} decode tok/s`;
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

export function toLocalPreset(run) {
  const quant = run.engine?.quantization || 'Unknown quant';
  const engine = run.engine?.engineName || 'Unknown engine';
  const modelName = run.model?.displayName || run.model?.hfId || 'Unknown model';

  return {
    id: `lmx:${run.id}`,
    name: `${hardwareName(run)} (${engine} ${quant} · ${run.tokSPrefill.toLocaleString()} / ${run.tokSOut.toLocaleString()} tok/s)`,
    prefillSpeed: run.tokSPrefill,
    decodeSpeed: run.tokSOut,
    icon: '📊',
    badge: 'LocalMaxxing run',
    vramBandwidth: 'Measured community result',
    description: `${modelName}; ${run.promptTokens || 0} prompt tokens; ${run.outputTokens || 0} output tokens; ${run.contextLength?.toLocaleString() || 'unknown'} context.`,
    sourceUrl: `https://localmaxxing.com/en/runs/${run.id}`,
    localMaxxing: true,
    hardwareKey: hardwareKey(run),
    run
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
