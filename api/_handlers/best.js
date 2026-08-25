import { aggregate } from '../_localmaxxing.js';
import { resolveRuns } from '../_snapshots.js';
import { sendJson } from '../_schema.js';
import { singleTurn, cost } from '../_math.js';
import { SCENARIO_PRESETS } from '../../src/utils/presets.js';
import { fitsInMemory } from '../_vramfit.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { buildCaveats, rowCaveats } from '../_caveats.js';
import { normalizeQueryModel } from '../_normalize.js';
import { matchesEngineQuery } from '../_engine.js';
import { confidence } from '../_crosscheck.js';
import { dataQuality } from '../_unit_audit.js';
import { sendProblemFromError } from '../_errors.js';
import { computeCalcId } from '../_calc_id.js';
import { filterByMaxAge, parseMaxAgeParam, resolveSnapshotAt } from '../_freshness.js';
import { parseContextBandParam, filterByContextBand } from '../_contextbands.js';
import { estimateStreetPrice } from '../../src/utils/streetPricing.js';
import { explainRecommendation } from '../_explain.js';
import { estimatePower } from '../../src/utils/powerThermal.js';
import { parseBool, boolWarnings } from '../_params.js';

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
  const requestedScenario = scenario == null || scenario === ''
    ? null
    : String(scenario).toLowerCase();
  const preset = requestedScenario
    ? SCENARIO_PRESETS.find(s => s.id === requestedScenario)
    : null;

  const p = Number(promptTokens);
  const o = Number(outputTokens);
  const hasP = Number.isFinite(p) && p > 0;
  const hasO = Number.isFinite(o) && o > 0;
  // Which axes came from explicit query params rather than the preset/default
  // (#836): lets workload.source stay honest for mixed requests.
  const overrides = [
    ...(hasP ? ['promptTokens'] : []),
    ...(hasO ? ['outputTokens'] : [])
  ];

  let source;
  if (overrides.length === 2) source = 'query';
  else if (preset && overrides.length) source = `mixed:${preset.id}+query`;
  else if (preset) source = `scenario:${preset.id}`;
  else if (overrides.length) source = 'mixed:default+query';
  else source = 'default:chat';

  return {
    promptTokens: Math.round(hasP ? p : preset?.promptTokens ?? CHAT_PRESET.promptTokens),
    outputTokens: Math.round(hasO ? o : preset?.outputTokens ?? CHAT_PRESET.outputTokens),
    source,
    overrides,
    requestedScenario,
    scenarioKnown: !requestedScenario || Boolean(preset),
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
        _efficiency: efficiencyScore({
          vramGb: sample.vramGb,
          unifiedMemoryGb: sample.unifiedMemoryGb,
          medianDecodeTokPerSec: g.decode.median
        }),
        source: sample.source
      };
    })
    .sort((a, b) =>
      ((by === 'walltime' ? a._rawWalltime - b._rawWalltime
      : by === 'confidence' ? (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0)
      : by === 'prefill' ? b.medianPrefillTokPerSec - a.medianPrefillTokPerSec
      // #605 #611: rank by decode tok/s per GB of rig memory instead of the
      // old constant-divisor no-op that silently equaled ?by=decode.
      : by === 'efficiency' ? (b._efficiency ?? -Infinity) - (a._efficiency ?? -Infinity)
      : b.medianDecodeTokPerSec - a.medianDecodeTokPerSec)) || byGroupKey(a, b)
    )
    .slice(0, limit)
    .map(({ _rawWalltime, _efficiency, ...entry }) =>
      by === 'efficiency' && _efficiency != null
        ? { ...entry, efficiencyTokPerSecPerGbVram: _efficiency }
        : entry);
}

/** Discrete VRAM if known, otherwise unified memory size. Null when unknown. */
function effectiveVramGb(run) {
  if (Number.isFinite(run.vramGb)) return run.vramGb;
  if (Number.isFinite(run.unifiedMemoryGb)) return run.unifiedMemoryGb;
  return null;
}

/**
 * Efficiency metric for ?by=efficiency (#605 #611): median decode throughput
 * per GB of rig memory (VRAM, falling back to unified memory). Null when the
 * group's memory size is unknown — such groups sort last instead of silently
 * re-using the decode ranking (the old comparator divided by a constant 1).
 */
export function efficiencyScore(row) {
  const mem = effectiveVramGb(row);
  if (!mem || mem <= 0 || !Number.isFinite(row.medianDecodeTokPerSec)) return null;
  return row.medianDecodeTokPerSec / mem;
}

function json(res, body, status = 200) {
  return sendJson(res, body, { status, cacheTtl: 600 });
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Deterministic final tie-break for ranked lists (#812 #813 #793): equal sort
// keys used to resolve by upstream insertion order, so the same calc_ id
// could replay to a different rank order or top-N membership. The composite
// group identity (hardwareKey|modelFamily) is stable content that total-orders
// whatever the primary metric leaves tied.
const byGroupKey = (a, b) =>
  String(a.hardwareKey ?? '').localeCompare(String(b.hardwareKey ?? '')) ||
  String(a.modelFamily ?? '').localeCompare(String(b.modelFamily ?? ''));

// Rough wall-power estimates when the caller doesn't pass ?powerWatts.
// Whole-rig figures (idle-ish load while serving), not TDP sums.
const DEFAULT_POWER_WATTS = { discrete_gpu: 300, unified: 60, cpu_only: 120 };

/**
 * GET /api/best — ranked answers to natural benchmark questions.
 *
 * ?by=decode|prefill|efficiency|walltime|cost|confidence  rank metric (default decode)
 * ?sort_by=<metric>                                        alias for ?by
 * ?scenario=<preset-id>                    workload shape for by=walltime / by=cost
 *                                          (chat|rag|longdoc|codegen|reasoning)
 * ?promptTokens=N&outputTokens=M           explicit workload shape for by=walltime / by=cost
 * ?model=<substr>                 restrict to model family / hfId substring
 * ?maxParamsB=8                   only models at or under this size
 * ?quant=q4_k_m                   exact quantization match (case-insensitive)
 * ?hwClass=discrete_gpu|unified|cpu_only
 * ?hardware=<substr>              restrict rigs by name substring
 * ?fitCheck=true|false            exclude rigs whose memory can't hold the model
 *                                 (1/true/yes/on vs 0/false/no/off; explicit
 *                                 false wins over contextLength)
 * ?contextLength=N                context for fitCheck (default 32768; implies
 *                                 fitCheck unless fitCheck=false)
 * ?precisionBytes=2               KV cache dtype for fitCheck (fp16 default)
 * ?batchSize=1                    KV cache batch for fitCheck
 * ?engine=<substr>                restrict to engine name/version tag substring (e.g. llama.cpp, b4523)
 * ?max_age=<days>                 exclude runs measured longer than N days ago
 * ?minDecode=N                    only groups with median decode ≥ N tok/s
 * ?maxVramGb=N                    only rigs with effective VRAM ≤ N GB
 *                                 (vramGb, falling back to unifiedMemoryGb)
 * ?limit=N                        default 10
 *
 * Response shaping for token-budgeted agents (issue #661) — both are
 * presentation-only and never change ranking or the calc id:
 * ?warnings=false|none|0          omit the boilerplate top-level `warnings`
 *                                 array (adds warningsOmitted: true)
 * ?fields=k1,k2,...               project each results[] row to only the
 *                                 named keys it actually has; unknown names
 *                                 are ignored (fieldsApplied echoes the kept
 *                                 ones, in row order of first appearance)
 *
 * Cost ranking (?by=cost) inputs:
 * ?price=<usd>                    hardware purchase price (per rig; default 0)
 * ?electricityRate=$/kWh          default 0.15
 * ?powerWatts=W                   default estimate by hwClass (see DEFAULT_POWER_WATTS)
 * ?amortizationMonths=M           spread hardware price over this many months (default 36)
 * ?promptTokens=&outputTokens=    scenario shape (defaults 2048/512)
 *
 * Every response carries a deterministic `id` (calc_<hash> of the resolved
 * filters) — replayable via /api/calc/<id>?endpoint=best&<same filters>.
 */
const RANK_BY = ['decode', 'prefill', 'efficiency', 'confidence'];

/**
 * Shared body builder for /api/best and /api/calc/<id>?endpoint=best replay
 * (issue #68). Returns { status, body }; body carries a deterministic `id`
 * hashed from the resolved filter set.
 */
export async function bestBody(query = {}) {
  const q = query;
  try {
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 10));
    const by = [...BY_MODES, 'cost'].includes(q.sort_by) ? q.sort_by : [...BY_MODES, 'cost'].includes(q.by) ? q.by : 'decode';
    const workload = resolveWorkload(q);
    const costInputs = {
      hardwarePriceUsd: num(q.hardwarePriceUsd ?? q.price, 0),
      electricityRatePerKwh: num(q.electricityRatePerKwh ?? q.electricityRate, 0.15),
      amortizationMonths: num(q.amortizationMonths, 36),
      // Workload shape resolves exactly like by=walltime (#631): explicit
      // tokens win, then the ?scenario= preset, then chat defaults — instead
      // of silently pricing every cost ranking at the 2048/512 chat shape.
      promptTokens: num(q.promptTokens, workload.promptTokens),
      outputTokens: num(q.outputTokens, workload.outputTokens)
    };
    // Accept compute's documented ?powerDrawWatts spelling alongside
    // ?powerWatts (#1111) so callers copying the /api/compute?model=cost
    // param names aren't silently ignored.
    const requestedPowerWatts = q.powerWatts ?? q.powerDrawWatts;

    let excludedUnknownVramGb = 0;
    const maxAgeDays = parseMaxAgeParam(q.max_age ?? q.maxAge);
    const contextBand = parseContextBandParam(q.context_band ?? q.contextBand);

    const { runs: liveRuns, snapshot } = await resolveRuns(q);
    // Issue #826: evaluate max_age against the dataset instant the response
    // describes (snapshot.createdAt = dataset fetch time, frozen for pinned
    // snapshots), NOT the per-request wall clock. Under ?snapshot= pinning the
    // rows are frozen but a wall-clock max_age kept shrinking the result set
    // on every replay day; now the pinned query is reproducible and
    // `snapshotAt` names the actual basis of the ageDays/freshness fields.
    const snapshotAt = resolveSnapshotAt(snapshot);
    let runs = liveRuns;

    if (q.model) {
      const m = normalizeQueryModel(q.model);
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
    if (maxAgeDays) runs = filterByMaxAge(runs, maxAgeDays, snapshotAt);
    runs = filterByContextBand(runs, contextBand);
    if (q.maxVramGb) {
      const maxV = Number(q.maxVramGb);
      if (Number.isFinite(maxV)) {
        // Count rigs dropped for UNKNOWN memory separately (#780): an agent
        // capping VRAM should be able to tell "over budget" from "no data".
        let unknownVram = 0;
        runs = runs.filter(r => {
          const v = effectiveVramGb(r);
          if (v == null) { unknownVram++; return false; }
          return v <= maxV;
        });
        excludedUnknownVramGb = unknownVram;
      }
    }

    // VRAM-fit filter: drop rigs whose memory can't hold the model weights
    // plus KV cache at the requested context. Estimates only — see _vramfit.js.
    // fitCheck is a real tri-state (#713): an explicit false/0/no/off wins
    // over contextLength (the off state is reachable); absent + contextLength>0
    // implies ON; absent alone is OFF. Unrecognized values warn instead of
    // being silently ignored (#688).
    const fitCtx = Number(q.contextLength);
    const fitCheckExplicit = parseBool(q.fitCheck);
    const fitCheck = fitCheckExplicit !== null ? fitCheckExplicit : (Number.isFinite(fitCtx) && fitCtx > 0);
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
    let groups = aggregate(runs, keyFn);

    // ?minDecode=N filters GROUPS by their true all-runs median decode,
    // post-aggregation (#599) — matching the documented contract ("only
    // groups with median decode ≥ N tok/s") and the Find-HW UI. Filtering
    // raw runs pre-aggregation would delete slow runs first and inflate the
    // reported medians (survivorship bias).
    let minDecodeFilter = null;
    if (q.minDecode) {
      const minD = Number(q.minDecode);
      if (Number.isFinite(minD)) {
        groups = groups.filter(g => g.decode.median >= minD);
        minDecodeFilter = minD;
      }
    }

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
            // hwClass arrives UPPERCASE on the wire (#482) — normalize the
            // lookup key so the per-class watt estimates aren't dead code
            // and every rig falls back to a flat 150 W (#1111).
            powerDrawWatts: num(requestedPowerWatts, DEFAULT_POWER_WATTS[String(sample.hwClass ?? '').toLowerCase()] ?? 150),
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
        .sort((a, b) => ((a.costUsdPerMillionTokens ?? Infinity) - (b.costUsdPerMillionTokens ?? Infinity)) || byGroupKey(a, b))
        .slice(0, limit);
    } else {
      ranked = rankGroups(groups, by, workload, limit);
      if (by === 'confidence') {
        // rankGroups doesn't know the confidence metric — sort here (#36).
        const confByKey = new Map(groups.map(g => [g.key, g.confidence ?? 0]));
        ranked = ranked.slice().sort((x, y) =>
          ((confByKey.get(`${y.hardwareKey}|${y.modelFamily}`)?.score ?? 0) - (confByKey.get(`${x.hardwareKey}|${x.modelFamily}`)?.score ?? 0)) || byGroupKey(x, y));
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
        // Context-band annotation (issue #39): rows whose runs were measured
        // across different context bands aren't apples-to-apples.
        row.contextBands = g.contextBands;
        row.mixedContextBands = g.mixedContextBands;
      }
      row.confidence = { ...confidence(members.get(`${row.hardwareKey}|${row.modelFamily}`) || []), ...(g?.confidence || {}) };
      // Unit-consistency audit over the group's runs (issue #43).
      row.dataQuality = dataQuality(members.get(`${row.hardwareKey}|${row.modelFamily}`) || []);
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

    // Attach per-group freshness metadata (#38): staleness of the newest run,
    // engine versions seen in the group, and mixed-build warnings.
    const freshByKey = new Map(groups.map(g => [g.key, g.freshness]));
    for (const row of ranked) {
      const f = freshByKey.get(`${row.hardwareKey}|${row.modelFamily}`);
      if (f) {
        row.newestRunAt = f.newestRunAt;
        row.newestAgeDays = f.newestAgeDays;
        row.staleness = f.staleness;
        row.engineVersions = f.engineVersions;
        row.majorReleaseWarnings = f.majorReleaseWarnings;
      }
    }

    const warnings = groups.filter(g => g.mixedEngines)
      .map(g => `${g.key} mixes engine versions (${g.engines.join(', ')}) — treat delta with caution`);
    warnings.push(...groups.filter(g => g.mixedContextBands)
      .map(g => `${g.key} mixes context-length bands (${(g.contextBands?.bands || []).map(b => b.label).join(', ')}) — measured tok/s depends on context; treat delta with caution or filter with ?context_band=`));
    warnings.push(...boolWarnings([['fitCheck', q.fitCheck]]));

    // Unknown ?scenario= ids are silently ignored by resolveWorkload (#840) —
    // name the rejected id in warnings[] so a typo'd preset is visible.
    if (workload.requestedScenario && !workload.scenarioKnown) {
      warnings.push(`Unknown ?scenario=${workload.requestedScenario} — not one of ${SCENARIO_PRESETS.map(s => s.id).join('|')}; the default ${CHAT_PRESET.promptTokens}/${CHAT_PRESET.outputTokens} chat shape was used instead.`);
    }

    const filters = { by, limit };
    if (q.model) filters.model = String(q.model).toLowerCase();
    if (q.maxParamsB) filters.maxParamsB = Number(q.maxParamsB);
    if (q.quant) filters.quant = String(q.quant).toLowerCase();
    if (q.hwClass) filters.hwClass = String(q.hwClass).toLowerCase();
    if (q.hardware) filters.hardware = String(q.hardware).toLowerCase();
    if (contextBand) filters.contextBand = contextBand;
    // Bind the id to every resolved input that shapes the result, not just
    // the headline filters — sets differing only in fit/context/engine/
    // staleness knobs used to mint identical ids (#557).
    if (fitCheck) filters.fitCheck = true;
    if (fitContextLength !== 32768 || fitCheck) filters.contextLength = fitContextLength;
    if (fitPrecisionBytes !== 2) filters.precisionBytes = fitPrecisionBytes;
    if (fitBatchSize !== 1) filters.batchSize = fitBatchSize;
    if (q.engine) filters.engine = String(q.engine);
    if (Number.isFinite(Number(q.minDecode)) && Number(q.minDecode) > 0) filters.minDecode = Number(q.minDecode);
    if (Number.isFinite(Number(q.maxVramGb)) && Number(q.maxVramGb) > 0) filters.maxVramGb = Number(q.maxVramGb);
    if (maxAgeDays) filters.maxAgeDays = maxAgeDays;
    if (minDecodeFilter != null) filters.minDecode = minDecodeFilter;

    // Attach effective VRAM (discrete, falling back to unified) per row (#53).
    const sampleByKey = new Map(groups.map(g => [g.key, g.bestRun]));
    for (const row of ranked) {
      const sample = sampleByKey.get(`${row.hardwareKey}|${row.modelFamily}`);
      row.effectiveVramGb = sample ? effectiveVramGb(sample) : null;
    }

    // Attach street-price estimates (#66): USD estimate with low/high range
    // plus eBay/Craigslist verification links; null when no anchor exists.
    const priceByKey = new Map(groups.map(g => [g.key, g.bestRun]));
    for (const row of ranked) {
      const sample = priceByKey.get(`${row.hardwareKey}|${row.modelFamily}`);
      row.pricing = sample ? estimateStreetPrice(sample) : null;
    }

    // Attach a one-sentence human-readable explanation per row (#73):
    // fit math + measured source, pass-through ready for agent chat
    // pipelines. Weight/KV figures are estimates (see _vramfit.js); the
    // tok/s figure is the group's measured median.
    for (const row of ranked) {
      const sample = sampleByKey.get(`${row.hardwareKey}|${row.modelFamily}`);
      row.explain = explainRecommendation({
        memoryGb: row.vramFit?.availableVramGb ?? row.effectiveVramGb,
        paramsB: sample?.paramsB,
        quantization: sample?.quantization,
        contextLength: fitContextLength,
        fit: row.vramFit ?? (sample ? fitsInMemory({ ...sample, contextLength: fitContextLength }) : null),
        decodeTokPerSec: row.medianDecodeTokPerSec,
        runId: sample?.runId,
        runsInGroup: row.runsInGroup
      });
    }

    // Attach power/thermal feasibility per row (#69): board power (TDP),
    // whole-rig inference wattage and PSU guidance — null when unknown
    // (cpu_only rigs, unmatched GPUs). The point: a dual-GPU recommendation
    // must never silently assume the user owns a 1600W PSU.
    const powerByKey = new Map(groups.map(g => [g.key, g.bestRun]));
    for (const row of ranked) {
      const sample = powerByKey.get(`${row.hardwareKey}|${row.modelFamily}`);
      row.power = sample ? estimatePower(sample) : null;
    }

    // Response shaping (#661): presentation-only slimming knobs. Applied to
    // the finished body so ranking, filtering and the calc id are untouched.
    const warningsOff = ['false', 'none', '0'].includes(String(q.warnings ?? '').toLowerCase());
    let fieldsApplied = null;
    if (q.fields) {
      const wanted = String(q.fields).split(',').map(s => s.trim()).filter(Boolean);
      const present = new Set();
      for (const row of ranked) {
        for (const name of wanted) if (Object.prototype.hasOwnProperty.call(row, name)) present.add(name);
      }
      fieldsApplied = [...present];
      for (const row of ranked) {
        const projected = {};
        for (const name of wanted) {
          if (Object.prototype.hasOwnProperty.call(row, name)) projected[name] = row[name];
        }
        // Mutate in place: `ranked` rows feed only the body below.
        for (const k of Object.keys(row)) delete row[k];
        Object.assign(row, projected);
      }
    }

    return {
      status: 200,
      body: {
        id: computeCalcId('best', filters),
      description: by === 'walltime'
        ? `Ranked hardware×model groups by projected end-to-end walltime for ${workload.promptTokens} prompt → ${workload.outputTokens} output tokens (${workload.source}${workload.scenarioLabel ? `, ${workload.scenarioLabel}` : ''}). Medians are outlier-resistant and carry a 95% percentile bootstrap CI (medianXxxCi95 + medianXxxLabel); overlapping intervals mean statistical ties. runsInGroup shows sample size, confidence grades how trustworthy each slot is (low = single submission), ?engine=<substr> restricts to same-engine builds only, and staleness/newestRunAt flag how old the newest measurement is; ?max_age=<days> drops older runs.`
        : by === 'cost'
        ? 'Ranked hardware×model groups by cost-efficiency: $/1M tokens from hardware price (amortized) + electricity at measured median speeds for the given scenario shape. Lower is better.'
        : by === 'efficiency'
        ? 'Ranked hardware×model groups by memory efficiency: median decode tok/s per GB of rig memory (VRAM, falling back to unified memory) — exposed per row as efficiencyTokPerSecPerGbVram. Groups with unknown memory size sort last. Other fields as in the speed ranking.'
        : 'Ranked hardware×model groups by measured community speed. Medians are outlier-resistant; runsInGroup shows sample size, confidence grades how trustworthy each slot is (low = single submission), ?engine=<substr> restricts to same-engine builds only, ?context_band=lt1k|1k-8k|8k-32k|32k+ restricts to one measured-context regime, and staleness/newestRunAt flag how old the newest measurement is; ?max_age=<days> drops older runs.',
      rankedBy: by,
      snapshot,
      snapshotAt: snapshotAt.toISOString(),
      maxAgeDays: maxAgeDays || null,
      contextBand: contextBand || null,
      requestedScenario: workload.requestedScenario,
      fitCheck,
      matchedRuns: runs.length,
      ...(fitCheck ? { excludedRuns: excludedByFit } : {}),
      ...(excludedUnknownVramGb > 0 ? { excludedUnknownVramGb } : {}),
      minDecode: minDecodeFilter,
      caveats: buildCaveats(runs, groups),
      ...(warningsOff ? { warningsOmitted: true } : { warnings }),
      ...(fieldsApplied ? { fieldsApplied } : {}),
      ...((by === 'walltime' || by === 'cost') ? {
        workload: {
          promptTokens: workload.promptTokens,
          outputTokens: workload.outputTokens,
          source: workload.source,
          overrides: workload.overrides,
          requestedScenario: workload.requestedScenario,
          ...(workload.scenarioLabel ? { scenario: workload.scenarioLabel } : {})
        }
      } : {}),
      results: ranked
      }
    };
  } catch (err) {
    throw err;
  }
}

export default async function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  try {
    const { status, body } = await bestBody(req.query || {});
    return json(res, body, status);
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
