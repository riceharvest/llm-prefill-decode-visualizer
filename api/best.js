import { getAllRuns, aggregate } from './_localmaxxing.js';
import { singleTurn } from './_math.js';
import { SCENARIO_PRESETS } from '../src/utils/presets.js';

export const config = { runtime: 'nodejs' };

const BY_MODES = ['decode', 'prefill', 'efficiency', 'walltime'];
// Default workload shape when no tokens or scenario are given: standard chat.
const CHAT_PRESET = SCENARIO_PRESETS.find(s => s.id === 'chat');

/**
 * Resolve the workload shape used for walltime projections.
 * Explicit promptTokens/outputTokens win; then a scenario=<preset-id> lookup
 * (see /api/presets); otherwise the standard-chat defaults apply.
 */
export function resolveWorkload({ scenario, promptTokens, outputTokens } = {}) {
  const preset = scenario
    ? SCENARIO_PRESETS.find(s => s.id === String(scenario).toLowerCase())
    : null;

  const p = Number(promptTokens);
  const o = Number(outputTokens);
  const hasP = Number.isFinite(p) && p > 0;
  const hasO = Number.isFinite(o) && o > 0;

  return {
    promptTokens: Math.round(hasP ? p : preset?.promptTokens ?? CHAT_PRESET.promptTokens),
    outputTokens: Math.round(hasO ? o : preset?.outputTokens ?? CHAT_PRESET.outputTokens),
    source: hasP && hasO
      ? 'query'
      : preset ? `scenario:${preset.id}` : 'default:chat',
    scenarioLabel: preset ? `${preset.icon} ${preset.label}` : null
  };
}

/** Project one turn's walltime for a group's median speeds. */
export function projectWalltime(medianPrefill, medianDecode, workload) {
  return singleTurn({
    promptTokens: workload.promptTokens,
    outputTokens: workload.outputTokens,
    prefillSpeed: medianPrefill,
    decodeSpeed: medianDecode
  });
}

/**
 * Build + sort the ranked group list. Exported pure so unit tests can feed
 * synthetic runs without hitting the upstream leaderboard.
 */
export function rankGroups(groups, by, workload, limit) {
  return groups
    .map(g => {
      const sample = g.bestRun;
      // Raw (unrounded) walltime for stable sorting even on near-ties.
      const rawWalltime =
        workload.promptTokens / g.prefill.median + workload.outputTokens / g.decode.median;
      const projection = projectWalltime(g.prefill.median, g.decode.median, workload);
      return {
        hardware: sample.hardware,
        hardwareKey: sample.hardwareKey,
        hwClass: sample.hwClass,
        gpu: sample.gpu,
        gpuCount: sample.gpuCount,
        vramGb: sample.vramGb,
        chip: sample.chip,
        unifiedMemoryGb: sample.unifiedMemoryGb,
        cpu: sample.cpu,
        modelFamily: sample.modelFamily,
        exampleModel: sample.modelName,
        quantization: sample.quantization,
        engine: sample.engine,
        runsInGroup: g.runs,
        medianPrefillTokPerSec: g.prefill.median,
        medianDecodeTokPerSec: g.decode.median,
        bestDecodeTokPerSec: g.decode.max,
        projectedWalltimeSeconds: projection.totalWalltimeSeconds,
        ttftSeconds: projection.ttftSeconds,
        decodeSeconds: projection.decodeSeconds,
        effectiveThroughputTokPerSec: projection.effectiveThroughputTokPerSec,
        prefillSharePct: projection.prefillSharePct,
        decodeSharePct: projection.decodeSharePct,
        _rawWalltime: rawWalltime,
        source: sample.source
      };
    })
    .sort((a, b) =>
      by === 'walltime' ? a._rawWalltime - b._rawWalltime
      : by === 'prefill' ? b.medianPrefillTokPerSec - a.medianPrefillTokPerSec
      : by === 'efficiency' ? (b.medianDecodeTokPerSec / Math.max(1, b.exampleModel ? 1 : 1)) - (a.medianDecodeTokPerSec / Math.max(1, a.exampleModel ? 1 : 1))
      : b.medianDecodeTokPerSec - a.medianDecodeTokPerSec
    )
    .slice(0, limit)
    .map(({ _rawWalltime, ...entry }) => entry);
}

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.end(JSON.stringify(body, null, 2));
}

/**
 * GET /api/best — ranked answers to natural benchmark questions.
 *
 * ?by=decode|prefill|efficiency|walltime   rank metric (default decode)
 * ?scenario=<preset-id>                    workload shape for by=walltime
 *                                          (chat|rag|longdoc|codegen|reasoning)
 * ?promptTokens=N&outputTokens=M           explicit workload shape for by=walltime
 * ?model=<substr>                 restrict to model family / hfId substring
 * ?maxParamsB=8                   only models at or under this size
 * ?quant=q4_k_m                   exact quantization match (case-insensitive)
 * ?hwClass=discrete_gpu|unified|cpu_only
 * ?hardware=<substr>              restrict rigs by name substring
 * ?limit=N                        default 10
 */
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 10));
    const by = BY_MODES.includes(q.by) ? q.by : 'decode';
    const workload = resolveWorkload(q);

    let runs = await getAllRuns();

    if (q.model) {
      const m = String(q.model).toLowerCase();
      runs = runs.filter(r => r.modelFamily.includes(m) || r.modelId?.toLowerCase().includes(m));
    }
    if (q.maxParamsB) {
      const maxP = Number(q.maxParamsB);
      if (Number.isFinite(maxP)) runs = runs.filter(r => r.paramsB && r.paramsB <= maxP);
    }
    if (q.quant) runs = runs.filter(r => r.quantization?.toLowerCase() === String(q.quant).toLowerCase());
    if (q.hwClass) runs = runs.filter(r => r.hwClass?.toLowerCase() === String(q.hwClass).toLowerCase());
    if (q.hardware) {
      const h = String(q.hardware).toLowerCase();
      runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(h) || r.hardware?.toLowerCase().includes(h));
    }

    // Rank per hardware rig × model family using the group's medians,
    // so one lucky run doesn't top the chart.
    const groups = aggregate(runs, r => `${r.hardwareKey}|${r.modelFamily}`);

    const ranked = rankGroups(groups, by, workload, limit);

    return json(res, {
      description: by === 'walltime'
        ? `Ranked hardware×model groups by projected end-to-end walltime for ${workload.promptTokens} prompt → ${workload.outputTokens} output tokens (${workload.source}${workload.scenarioLabel ? `, ${workload.scenarioLabel}` : ''}). Medians are outlier-resistant; runsInGroup shows sample size.`
        : 'Ranked hardware×model groups by measured community speed. Medians are outlier-resistant; runsInGroup shows sample size.',
      rankedBy: by,
      matchedRuns: runs.length,
      ...(by === 'walltime' ? {
        workload: {
          promptTokens: workload.promptTokens,
          outputTokens: workload.outputTokens,
          source: workload.source,
          ...(workload.scenarioLabel ? { scenario: workload.scenarioLabel } : {})
        }
      } : {}),
      results: ranked
    });
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 502);
  }
}
