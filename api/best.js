import { aggregate } from './_localmaxxing.js';
import { resolveRuns } from './_snapshots.js';
import { sendJson } from './_schema.js';
import { singleTurn, cost } from './_math.js';
import { SCENARIO_PRESETS } from '../src/utils/presets.js';
import { fitsInMemory } from './_vramfit.js';
import { enforceRateLimit } from './_ratelimit.js';
import { buildCaveats, rowCaveats } from './_caveats.js';
import { matchesEngineQuery } from './_engine.js';
import { confidence } from './_crosscheck.js';

export const config = { runtime: 'nodejs' };

const BY_MODES = ['decode', 'prefill', 'efficiency', 'walltime', 'confidence'];
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
  // workload is optional for non-walltime rankings (e.g. ?by=confidence).
  const wl = workload ?? { promptTokens: 0, outputTokens: 0 };
  return groups
    .map(g => {
      const sample = g.bestRun;
      // Raw (unrounded) walltime for stable sorting even on near-ties.
      const rawWalltime =
        wl.promptTokens / g.prefill.median + wl.outputTokens / g.decode.median;
      const projection = projectWalltime(g.prefill.median, g.decode.median, wl);
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
        confidence: g.confidence,
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
      : by === 'confidence' ? (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0)
      : by === 'prefill' ? b.medianPrefillTokPerSec - a.medianPrefillTokPerSec
      : by === 'efficiency' ? (b.medianDecodeTokPerSec / Math.max(1, b.exampleModel ? 1 : 1)) - (a.medianDecodeTokPerSec / Math.max(1, a.exampleModel ? 1 : 1))
      : b.medianDecodeTokPerSec - a.medianDecodeTokPerSec
    )
    .slice(0, limit)
    .map(({ _rawWalltime, ...entry }) => entry);
}

function json(res, body, status = 200) {
  return sendJson(res, body, { status, cacheTtl: 600 });
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Rough wall-power estimates when the caller doesn't pass ?powerWatts.
// Whole-rig figures (idle-ish load while serving), not TDP sums.
const DEFAULT_POWER_WATTS = { discrete_gpu: 300, unified: 60, cpu_only: 120 };

/**
 * GET /api/best — ranked answers to natural benchmark questions.
 *
 * ?by=decode|prefill|efficiency|walltime|cost|confidence  rank metric (default decode)
 * ?sort_by=<metric>                                        alias for ?by
 * ?scenario=<preset-id>                    workload shape for by=walltime
 *                                          (chat|rag|longdoc|codegen|reasoning)
 * ?promptTokens=N&outputTokens=M           explicit workload shape for by=walltime
 * ?model=<substr>                 restrict to model family / hfId substring
 * ?maxParamsB=8                   only models at or under this size
 * ?quant=q4_k_m                   exact quantization match (case-insensitive)
 * ?hwClass=discrete_gpu|unified|cpu_only
 * ?hardware=<substr>              restrict rigs by name substring
 * ?fitCheck=true                  exclude rigs whose memory can't hold the model
 * ?contextLength=N                context for fitCheck (default 32768; implies fitCheck)
 * ?precisionBytes=2               KV cache dtype for fitCheck (fp16 default)
 * ?batchSize=1                    KV cache batch for fitCheck
 * ?engine=<substr>                restrict to engine name/version tag substring (e.g. llama.cpp, b4523)
 * ?limit=N                        default 10
 *
 * Cost ranking (?by=cost) inputs:
 * ?price=<usd>                    hardware purchase price (per rig; default 0)
 * ?electricityRate=$/kWh          default 0.15
 * ?powerWatts=W                   default estimate by hwClass (see DEFAULT_POWER_WATTS)
 * ?amortizationMonths=M           spread hardware price over this many months (default 36)
 * ?promptTokens=&outputTokens=    scenario shape (defaults 2048/512)
 */
const RANK_BY = ['decode', 'prefill', 'efficiency', 'confidence'];

export default async function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  try {
    const q = req.query || {};
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 10));
    const by = [...BY_MODES, 'cost'].includes(q.sort_by) ? q.sort_by : [...BY_MODES, 'cost'].includes(q.by) ? q.by : 'decode';
    const workload = resolveWorkload(q);
    const costInputs = {
      hardwarePriceUsd: num(q.hardwarePriceUsd ?? q.price, 0),
      electricityRatePerKwh: num(q.electricityRatePerKwh ?? q.electricityRate, 0.15),
      amortizationMonths: num(q.amortizationMonths, 36),
      promptTokens: num(q.promptTokens, 2048),
      outputTokens: num(q.outputTokens, 512)
    };

    const { runs, snapshot } = await resolveRuns(q);

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
    if (q.engine) runs = runs.filter(r => matchesEngineQuery(r, String(q.engine)));

    // VRAM-fit filter: drop rigs whose memory can't hold the model weights
    // plus KV cache at the requested context. Estimates only — see _vramfit.js.
    const fitCtx = Number(q.contextLength);
    const fitCheck = q.fitCheck === 'true' || (Number.isFinite(fitCtx) && fitCtx > 0);
    const fitContextLength = Math.min(1e6, Math.max(256, fitCtx > 0 ? Math.round(fitCtx) : 32768));
    const fitPrecisionBytes = Number(q.precisionBytes) > 0 ? Number(q.precisionBytes) : 2;
    const fitBatchSize = Math.max(1, Math.round(Number(q.batchSize)) || 1);
    let excludedByFit = 0;
    if (fitCheck) {
      const before = runs.length;
      runs = runs.filter(r => {
        const fit = fitsInMemory({ ...r, contextLength: fitContextLength, precisionBytes: fitPrecisionBytes, batchSize: fitBatchSize });
        return fit?.fits === true;
      });
      excludedByFit = before - runs.length;
    }

    // Rank per hardware rig × model family using the group's medians,
    // so one lucky run doesn't top the chart. confidence shows how much to
    // trust each median (sample size, IQR width, outlier density).
    // so one lucky run doesn't top the chart.
    const keyFn = r => `${r.hardwareKey}|${r.modelFamily}`;
    const groups = aggregate(runs, keyFn);

    const members = new Map();
    for (const run of runs) {
      const k = keyFn(run);
      if (!k) continue;
      if (!members.has(k)) members.set(k, []);
      members.get(k).push(run);
    }

    let ranked;
    if (by === 'cost') {
      ranked = groups
        .map(g => {
          const sample = g.bestRun;
          const c = cost({
            ...costInputs,
            powerDrawWatts: num(q.powerWatts, DEFAULT_POWER_WATTS[sample.hwClass] ?? 150),
            prefillSpeed: g.prefill.median,
            decodeSpeed: g.decode.median
          });
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
            source: sample.source,
            costInputs: {
              hardwarePriceUsd: c.inputs.hardwarePriceUsd,
              electricityRatePerKwh: c.inputs.electricityRatePerKwh,
              powerDrawWatts: c.inputs.powerDrawWatts,
              amortizationMonths: c.inputs.amortizationMonths,
              promptTokens: c.inputs.promptTokens,
              outputTokens: c.inputs.outputTokens
            },
            effectiveThroughputTokPerSec: c.effectiveThroughputTokPerSec,
            totalCostUsdPerHour: c.totalCostUsdPerHour,
            costUsdPerMillionTokens: c.costUsdPerMillionTokens,
            costUsdPerThousandRequests: c.costUsdPerThousandRequests
          };
        })
        .sort((a, b) => (a.costUsdPerMillionTokens ?? Infinity) - (b.costUsdPerMillionTokens ?? Infinity))
        .slice(0, limit);
    } else {
      ranked = rankGroups(groups, by, workload, limit);
      if (by === 'confidence') {
        // rankGroups doesn't know the confidence metric — sort here (#36).
        const confByKey = new Map(groups.map(g => [g.key, g.confidence ?? 0]));
        ranked = ranked.slice().sort((x, y) =>
          (confByKey.get(`${y.hardwareKey}|${y.modelFamily}`)?.score ?? 0) - (confByKey.get(`${x.hardwareKey}|${x.modelFamily}`)?.score ?? 0));
      }    }
    if (fitCheck) {
      // Attach the estimated fit verdict for each ranked group's best run.
      const bestByKey = new Map(groups.map(g => [g.key, g.bestRun]));
      for (const row of ranked) {
        const sample = bestByKey.get(`${row.hardwareKey}|${row.modelFamily}`);
        if (sample) {
          row.vramFit = fitsInMemory({ ...sample, contextLength: fitContextLength, precisionBytes: fitPrecisionBytes, batchSize: fitBatchSize });
        }
      }
    }

    // Attach statistical caveats (#19), engine cohort info (#29) and
    // data-quality confidence blocks (#32) per row.
    const grpByKey = new Map(groups.map(g => [g.key, g]));
    for (const row of ranked) {
      const g = grpByKey.get(`${row.hardwareKey}|${row.modelFamily}`);
      if (g) {
        row.caveats = rowCaveats(g);
        row.engineVersion = g.bestRun?.engineVersion ?? null;
        row.engines = g.engines;
        row.mixedEngines = g.mixedEngines;
      }
      row.confidence = { ...confidence(members.get(`${row.hardwareKey}|${row.modelFamily}`) || []), ...(g?.confidence || {}) };
    }

    // Attach 95% percentile bootstrap CIs per row (#43).
    for (const row of ranked) {
      const g = grpByKey.get(`${row.hardwareKey}|${row.modelFamily}`);
      if (g) {
        row.medianPrefillCi95 = g.prefill.ci95;
        row.medianPrefillLabel = g.prefill.label;
        row.medianDecodeCi95 = g.decode.ci95;
        row.medianDecodeLabel = g.decode.label;
      }
    }

    const warnings = groups.filter(g => g.mixedEngines)
      .map(g => `${g.key} mixes engine versions (${g.engines.join(', ')}) — treat delta with caution`);

    return json(res, {
      description: by === 'walltime'
        ? `Ranked hardware×model groups by projected end-to-end walltime for ${workload.promptTokens} prompt → ${workload.outputTokens} output tokens (${workload.source}${workload.scenarioLabel ? `, ${workload.scenarioLabel}` : ''}). Medians are outlier-resistant and carry a 95% percentile bootstrap CI (medianXxxCi95 + medianXxxLabel); overlapping intervals mean statistical ties. runsInGroup shows sample size, confidence grades how trustworthy each slot is (low = single submission), and ?engine=<substr> restricts to same-engine builds only.`
        : by === 'cost'
        ? 'Ranked hardware×model groups by cost-efficiency: $/1M tokens from hardware price (amortized) + electricity at measured median speeds for the given scenario shape. Lower is better.'
        : 'Ranked hardware×model groups by measured community speed. Medians are outlier-resistant; runsInGroup shows sample size, confidence grades how trustworthy each slot is (low = single submission), and ?engine=<substr> restricts to same-engine builds only.',
      rankedBy: by,
      snapshot,
      matchedRuns: runs.length,
      caveats: buildCaveats(runs, groups),
      warnings,
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
