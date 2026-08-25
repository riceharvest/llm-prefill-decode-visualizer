import { HARDWARE_PRESETS, SCENARIO_PRESETS } from '../../src/utils/presets.js';
import {
  singleTurn,
  speculative,
  batched,
  agentic,
  kvCache,
  cost
} from '../_math.js';
import { ENGINE_FLAGS, applyEngineFlags } from '../../src/utils/engineFlags.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson, withSchemaVersion, applySchemaHeaders } from '../_schema.js';
import { ApiError, sendProblemFromError, ERROR_CODES, problemType } from '../_errors.js';
import { computeCalcId } from '../_calc_id.js';
import { normalizeParams } from '../_calc_id.js';
import { annotate, THEORETICAL } from '../_basis.js';
import { empiricalDecayExponentCaveat, heuristicFlagDeltasCaveat } from '../_caveats.js';
import { ROUTES } from '../_route_table.js';
import {
  resolveSingleTurnFeatures,
  simulateSingleTurnFeatures,
  evaluateSlo
} from '../_single_turn_features.js';
import { resolveVisionInputs } from '../_vision.js';
import { generateRequests, simulateBatching } from '../../src/utils/batchScheduling.js';

export const config = { runtime: 'nodejs' };

// otherEndpoints for the bare /api/compute capability index (#712): derived
// from the central route table (the same source of truth behind agents.json)
// so the self-describing front door always advertises the FULL surface —
// including /api/spec itself — instead of a hand-picked subset. /compute is
// excluded (this response IS that endpoint); non-route doc surfaces that
// agents need at bootstrap (/llms.txt) are appended explicitly.
const OTHER_ENDPOINTS = [
  ...ROUTES.filter(r => r.path !== '/compute').map(r => `/api${r.path}`),
  '/llms.txt'
];


// Max parameter sets accepted in one batch call (documented in the
// capability list and /llms.txt). Keeps responses bounded.
export const MAX_BATCH_SIZE = 50;

const MODEL_PRESETS = {
  llama70b:  { numLayers: 80, hiddenSize: 8192, kvHeads: 8, numHeads: 64, headDim: 128, maxContext: 131072 },
  llama8b:   { numLayers: 32, hiddenSize: 4096, kvHeads: 8, numHeads: 32, headDim: 128, maxContext: 131072 },
  qwen72b:   { numLayers: 80, hiddenSize: 8192, kvHeads: 8, numHeads: 64, headDim: 128, maxContext: 131072 },
  mistral7b: { numLayers: 32, hiddenSize: 4096, kvHeads: 8, numHeads: 32, headDim: 128, maxContext: 131072 }
};

// Documented KV-cache precisions (/api/spec declares enum [2, 1, 0.5]).
const PRECISION_BYTES_ENUM = [2, 1, 0.5];

// Case/dash-insensitive architecture-id matching (#764): 'Llama-70B',
// 'Mistral-7B', 'qwen-72b' resolve to their preset instead of silently
// falling back to generic geometry.
export function normalizeArchKey(id) {
  if (id == null) return null;
  const key = String(id).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return key === '' ? null : key;
}

// Integer-valued kvCache inputs where values < 1 are physically invalid
// (#775): zero or negative context/batch/layers cancel signs and yield
// plausible-looking garbage.
function positiveIntParam(params, name, fallback) {
  const raw = params[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new ApiError('INVALID_PARAMS', `${name} must be a number (got '${raw}')`, {
      extras: { param: name, received: String(raw) }
    });
  }
  const rounded = Math.round(n);
  if (rounded < 1) {
    throw new ApiError('INVALID_PARAMS', `${name} must be >= 1 (got ${n}) — non-positive values are physically invalid for KV-cache geometry`, {
      extras: { param: name, received: n }
    });
  }
  return rounded;
}

// Thin wrapper over the shared sender so every response carries
// schema_version + X-Schema-Version (see _schema.js / CHANGELOG-API.md).
function json(res, body, status = 200) {
  return sendJson(res, body, { status });
}

// Stamp a deterministic calc_<hash> id derived from the RESOLVED inputs,
// so omitting an explicit default yields the identical id (#68).
// With dryRun, skip the math entirely and echo the parsed inputs instead
// (#17): the id is the SAME hash a real call with these inputs would
// return, so a dry run can be swapped for the real call 1:1.
function withId(model, inputs, result, dryRun = false, substitutions = []) {
  const id = computeCalcId('compute', { model, ...normalizeParams(inputs) });
  if (dryRun) {
    return { status: 200, body: {
      ...dryRunBody(model, inputs, id),
      // #385: the dry-run echo must show the same substitution warnings the
      // real call would produce, so agents can debug payloads cheaply.
      ...(substitutions.length ? { warnings: inputSubstitutionWarnings(substitutions) } : {})
    } };
  }
  return { status: 200, body: { id, ...mergeInputWarnings(result, substitutions) } };
}

// dry_run=true (or 1 / dryRun alias): validate + echo, never execute (#17).
export function isDryRun(params = {}) {
  const v = params.dry_run ?? params.dryRun;
  return v === true || v === 'true' || v === '1' || v === 1;
}

function dryRunBody(model, inputs, id) {
  return {
    dry_run: true,
    model,
    inputs,
    ...(id ? { id } : {}),
    note: 'Validated only — nothing was computed. Resend without dry_run to execute; a dry_run request returns the same deterministic id as the real call.'
  };
}

// Issue #385: a present-but-unparseable numeric param silently mapped to its
// default with warnings:[] — an agent sending a typo'd/unit-broken value got
// confident-looking numbers for the wrong workload. trackNum() behaves exactly
// like num() but records every substitution so the handler can surface it.
// Valid inputs are untouched: responses stay byte-identical and calc ids
// (hashed from resolved inputs) never change.
function trackNum(substitutions) {
  return (v, fallback, field) => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    substitutions.push({ param: field, requested: String(v), used: fallback });
    return fallback;
  };
}

export function inputSubstitutionWarnings(substitutions) {
  return substitutions.map(s => ({
    code: 'input_not_numeric_default_used',
    param: s.param,
    requested: s.requested,
    used: s.used,
    message: `Parameter '${s.param}=${s.requested}' is not a finite number — used default ${s.used}. Resend with a numeric value for an exact prediction.`
  }));
}

// Prepend input-substitution warnings to a result body, keeping any
// physics/sanity warnings that follow. No-op when every param parsed clean.
function mergeInputWarnings(result, substitutions) {
  if (!substitutions.length) return result;
  return {
    ...result,
    warnings: [...inputSubstitutionWarnings(substitutions), ...(result.warnings || [])]
  };
}

// Positive finite number or null — gates the optional agentic extras (#492 #493).
function posNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Hardware-preset bridge (#476): llms.txt says "use /api/presets as
 * /api/compute inputs" — this makes ?preset=<hardware preset id> actually do
 * that. A known id fills prefillSpeed/decodeSpeed for any speed the caller
 * did NOT pass explicitly (explicit params still win); an unknown id is
 * reported via a non-blocking warning instead of being silently dropped.
 */
export function resolveHardwarePreset(params = {}) {
  const id = params.preset;
  if (id === undefined || id === null || String(id) === '') {
    return { speeds: {}, echo: undefined, warning: undefined };
  }
  const found = HARDWARE_PRESETS.find(p => p.id === id);
  if (!found) {
    return {
      speeds: {},
      echo: undefined,
      warning: {
        code: 'unknown_preset',
        message: `Unknown hardware preset '${id}' — default speeds were used. Browse ids via /api/presets.`,
        available: HARDWARE_PRESETS.map(p => p.id)
      }
    };
  }
  return {
    speeds: { prefillSpeed: found.prefillSpeed, decodeSpeed: found.decodeSpeed },
    echo: { id: found.id, name: found.name },
    warning: undefined
  };
}

// Attach the ?preset= echo + any unknown-preset warning to a result body.
// Purely additive fields; absent when no preset was requested.
function withPresetMeta(params, body) {
  const { echo, warning } = resolveHardwarePreset(params);
  if (!echo && !warning) return body;
  return {
    ...body,
    ...(echo ? { presetApplied: echo } : {}),
    ...(warning ? { warnings: [...(body.warnings || []), warning] } : {})
  };
}

// Cap on how many engine steps are returned in the simulation block, so a
// pathological workload can't produce a multi-megabyte response.
export const MAX_SCHEDULE_STEPS_RETURNED = 500;

const r6 = (x) => Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x;

/**
 * Extend the batched model with the Batching view's discrete scheduler
 * (issue #529): chunked prefill, staggered arrivals, continuous-batching
 * admission and queueing. Runs src/utils/batchScheduling.js — the exact
 * module the UI animates — so API numbers and the tab agree. The legacy
 * aggregate curve stays in the response; the schedule rides additively in
 * `simulation`.
 */
function batchedWithSchedule(sim) {
  const requests = generateRequests({
    numRequests: sim.numRequests,
    meanPromptTokens: sim.promptTokens,
    meanOutputTokens: sim.outputTokens,
    arrivalIntervalMs: sim.arrivalIntervalMs,
    seed: sim.seed
  });
  const { steps, requests: timeline, makespan, summary } = simulateBatching({
    requests,
    maxBatchSize: sim.maxBatchSize,
    // chunkTokens=0 disables chunked prefill (whole prompt per step).
    chunkSize: sim.chunkTokens > 0 ? sim.chunkTokens : NaN,
    prefillSpeed: sim.prefillSpeed,
    decodeSpeed: sim.decodeSpeed
  });

  // Per-step queue depth: arrivals seen by step end minus cumulative
  // admissions (every arrived request is admitted or queued).
  let arrivedIdx = 0;
  let admittedTotal = 0;
  const stepsOut = steps.map(s => {
    while (arrivedIdx < timeline.length && timeline[arrivedIdx].arrivalTime <= s.tEnd + 1e-12) arrivedIdx++;
    admittedTotal += s.admitted.length;
    return {
      index: s.index,
      tStartSeconds: r6(s.tStart),
      tEndSeconds: r6(s.tEnd),
      durationSeconds: r6(s.duration),
      phase: s.prefill ? (s.decoded.length > 0 ? 'prefill+decode' : 'prefill') : 'decode',
      batchSize: s.batchSize,
      queued: Math.max(0, arrivedIdx - admittedTotal),
      admitted: s.admitted,
      finished: s.finished,
      prefill: s.prefill ? { id: s.prefill.id, tokens: s.prefill.tokens } : null,
      decodedCount: s.decoded.length
    };
  });

  return {
    ...batched({
      promptTokens: sim.promptTokens,
      outputTokens: sim.outputTokens,
      batchSize: sim.batchSize,
      prefillSpeed: sim.prefillSpeed,
      decodeSpeed: sim.decodeSpeed,
      decodeDecayExponent: sim.decodeDecayExponent
    }),
    scheduling: 'engine-step simulation (chunked prefill + arrivals + queueing) — same model as the Batching view; supersedes the B^0.25 approximation when chunking/arrivals matter',
    simulation: {
      inputs: {
        numRequests: sim.numRequests,
        maxBatchSize: sim.maxBatchSize,
        promptTokens: sim.promptTokens,
        outputTokens: sim.outputTokens,
        prefillSpeed: sim.prefillSpeed,
        decodeSpeed: sim.decodeSpeed,
        chunkTokens: sim.chunkTokens,
        arrivalIntervalMs: sim.arrivalIntervalMs,
        seed: sim.seed
      },
      stepCount: steps.length,
      stepsTruncated: steps.length > MAX_SCHEDULE_STEPS_RETURNED,
      makespanSeconds: r6(makespan),
      summary: {
        totalOutputTokens: summary.totalOutputTokens,
        throughputTokPerSec: r6(summary.throughput),
        avgTTFTSeconds: r6(summary.avgTTFT),
        maxTTFTSeconds: r6(summary.maxTTFT),
        avgITLSeconds: r6(summary.avgITL),
        maxITLSeconds: r6(summary.maxITL),
        occupancyPct: r6(summary.occupancyPct),
        stalledStepPct: r6(summary.stalledStepPct)
      },
      steps: stepsOut.slice(0, MAX_SCHEDULE_STEPS_RETURNED),
      requests: timeline.map(r => ({
        id: r.id,
        promptTokens: r.promptTokens,
        outputTokens: r.outputTokens,
        arrivalTimeSeconds: r6(r.arrivalTime),
        firstTokenTimeSeconds: r6(r.firstTokenTime),
        finishTimeSeconds: r6(r.finishTime),
        ttftSeconds: r.ttft === null ? null : r6(r.ttft),
        itlCount: Array.isArray(r.itls) ? r.itls.length : 0
      }))
    }
  };
}

// Run one parameter set. Returns { status, body } — never throws for
// expected input problems; unexpected math errors bubble up to the caller.
// With dryRun, each branch validates + echoes its parsed inputs instead of
// executing the simulation (#17).
function computeOne(params, dryRun = false) {
  const model = params.model || params.m || '';
  // #385: per-request substitution log, fed by the branch-local trackNum().
  const subs = [];
  const num = trackNum(subs);

  switch (model) {
    case 'singleTurn': {
      const { speeds } = resolveHardwarePreset(params);
      const inputs = {
        promptTokens: num(params.promptTokens, 2048, 'promptTokens'),
        outputTokens: num(params.outputTokens, 512, 'outputTokens'),
        prefillSpeed: num(params.prefillSpeed, speeds.prefillSpeed ?? 3800, 'prefillSpeed'),
        decodeSpeed: num(params.decodeSpeed, speeds.decodeSpeed ?? 105, 'decodeSpeed')
      };
      // Engine features (#472): ITL jitter / context scaling / attached
      // images — opt-in; when none requested the plain math runs untouched.
      const features = resolveSingleTurnFeatures(params);
      let body = features
        ? simulateSingleTurnFeatures(inputs, features)
        : singleTurn(inputs);
      // SLO budgets (#480): optional server-side pass/fail evaluation.
      const slo = evaluateSlo({
        maxTtftSeconds: params.maxTtftSeconds,
        maxTpotMs: params.maxTpotMs,
        ttftSeconds: body.ttftSeconds,
        tpotMs: body.tpotMs
      });
      if (slo) body = { ...body, slo };
      return withId('singleTurn', inputs, withPresetMeta(params, body), dryRun, subs);
    }

    case 'speculative': {
      const inputs = {
        baseDecodeSpeed: num(params.baseDecodeSpeed ?? params.decodeSpeed, 105, 'baseDecodeSpeed'),
        draftTokens: num(params.draftTokens, 4, 'draftTokens'),
        acceptanceRate: num(params.acceptanceRate, 0.7, 'acceptanceRate'),
        draftCostFraction: num(params.draftCostFraction, 0.2, 'draftCostFraction')
      };
      return withId('speculative', inputs, speculative(inputs), dryRun, subs);
    }

    case 'batched': {
      const { speeds: bSpeeds } = resolveHardwarePreset(params);
      const inputs = {
        prefillSpeed: num(params.prefillSpeed, bSpeeds.prefillSpeed ?? 3800, 'prefillSpeed'),
        decodeSpeed: num(params.decodeSpeed, bSpeeds.decodeSpeed ?? 105, 'decodeSpeed'),
        batchSize: num(params.batchSize, 1, 'batchSize'),
        promptTokens: num(params.promptTokens, 4096, 'promptTokens'),
        outputTokens: num(params.outputTokens, 512, 'outputTokens'),
        decodeDecayExponent: num(params.decodeDecayExponent, 0.25, 'decodeDecayExponent')
      };
      // Scheduling mode (issue #529): any of these optional params switches
      // the response from the smooth B^0.25 aggregate curve to a discrete
      // engine-step schedule (chunked prefill + staggered arrivals +
      // queueing), the same model the Batching view animates. Absent params
      // keep the legacy response byte-compatible.
      if (
        params.chunkTokens !== undefined ||
        params.arrivalIntervalMs !== undefined ||
        params.numRequests !== undefined
      ) {
        const simInputs = {
          ...inputs,
          numRequests: Math.min(50, Math.max(1, Math.round(num(params.numRequests, Math.max(inputs.batchSize, 1), 'numRequests')))),
          maxBatchSize: Math.min(50, Math.max(1, Math.round(num(params.maxBatchSize ?? params.batchSize, inputs.batchSize, 'maxBatchSize')))),
          chunkTokens: Math.max(0, num(params.chunkTokens, 512, 'chunkTokens')),
          arrivalIntervalMs: Math.max(0, num(params.arrivalIntervalMs, 0, 'arrivalIntervalMs')),
          seed: Math.round(num(params.seed, 42, 'seed'))
        };
        return withId('batched', simInputs, withPresetMeta(params, batchedWithSchedule(simInputs)), dryRun, subs);
      }
      return withId('batched', inputs, withPresetMeta(params, batched(inputs)), dryRun, subs);
    }

    case 'agentic': {
      const { speeds } = resolveHardwarePreset(params);
      const requested = Math.min(50, Math.max(1, num(params.numTurns, 4, 'numTurns')));
      // #783: the spec declares numTurns an integer but fractional values
      // were accepted, floored silently by the turn loop, and echoed back
      // verbatim in inputs (so the calc id hashed a count that never ran).
      // Floor at parse time so `inputs.numTurns` echoes the EXECUTED count,
      // and flag the coercion in warnings[] when it engaged.
      const numTurns = Math.floor(requested);
      const inputs = {
        numTurns,
        basePromptTokens: num(params.basePromptTokens, 1500, 'basePromptTokens'),
        toolOutputTokensPerTurn: num(params.toolOutputTokensPerTurn, 800, 'toolOutputTokensPerTurn'),
        decodeTokensPerTurn: num(params.decodeTokensPerTurn, 250, 'decodeTokensPerTurn'),
        prefillSpeed: num(params.prefillSpeed, speeds.prefillSpeed ?? 3800, 'prefillSpeed'),
        decodeSpeed: num(params.decodeSpeed, speeds.decodeSpeed ?? 105, 'decodeSpeed'),
        enablePrefixCaching: params.enablePrefixCaching !== 'false' && params.enablePrefixCaching !== false
      };
      // Optional extras (#492 #493): only added to inputs when provided, so
      // requests without them keep their existing deterministic calc id.
      for (const key of ['contextWindowTokens', 'sloTtftSec', 'sloTpotMs', 'sloTurnWalltimeSec', 'sloWalltimeSec']) {
        const v = posNum(params[key]);
        if (v !== null) inputs[key] = v;
      }
      let body = agentic(inputs);
      if (numTurns !== requested) {
        body.warnings.push({
          code: 'num_turns_floored',
          message: `numTurns=${requested} is fractional — the simulation ran ${numTurns} turns; inputs echo the executed count.`
        });
      }
      // SLO budgets (#480): evaluated against the loop's first-token latency
      // (ttftSeconds) and its implied per-token time.
      const slo = evaluateSlo({
        maxTtftSeconds: params.maxTtftSeconds,
        maxTpotMs: params.maxTpotMs,
        ttftSeconds: body.ttftSeconds,
        tpotMs: inputs.decodeSpeed > 0 ? 1000 / inputs.decodeSpeed : null
      });
      if (slo) body = { ...body, slo };
      return withId('agentic', inputs, withPresetMeta(params, body), dryRun, subs);
    }

    case 'kvCache': {
      // Case/dash-insensitive architecture-id matching (#764): an unknown id
      // no longer throws — it falls back LOUDLY via a warning below.
      const rawArch = params.architecture;
      const presetKey = rawArch != null && String(rawArch).trim() !== '' ? String(rawArch).trim() : undefined;
      const normalized = normalizeArchKey(presetKey);
      const preset = (presetKey && (MODEL_PRESETS[presetKey] || MODEL_PRESETS[normalized])) || null;

      // Input validation (#775): reject non-numeric and non-positive values
      // instead of silently defaulting or multiplying sign-cancelled garbage.
      const inputs = {
        architecture: preset ? (MODEL_PRESETS[presetKey] ? presetKey : normalized) : (presetKey || 'generic'),
        numLayers: positiveIntParam(params, 'numLayers', preset?.numLayers ?? 80),
        kvHeads: positiveIntParam(params, 'kvHeads', preset?.kvHeads ?? 8),
        headDim: positiveIntParam(params, 'headDim', preset?.headDim ?? 128),
        contextLength: positiveIntParam(params, 'contextLength', 32768),
        precisionBytes: (() => {
          const raw = params.precisionBytes;
          if (raw === undefined || raw === null || raw === '') return 2;
          const n = Number(raw);
          if (!Number.isFinite(n) || !PRECISION_BYTES_ENUM.includes(n)) {
            throw new ApiError('INVALID_PARAMS', `precisionBytes must be one of ${PRECISION_BYTES_ENUM.join(', ')} (FP16/FP8/INT4); got '${raw}'`, {
              extras: { param: 'precisionBytes', allowed: PRECISION_BYTES_ENUM }
            });
          }
          return n;
        })(),
        batchSize: positiveIntParam(params, 'batchSize', 1)
      };

      const warnings = [];

      // (#643) vision tokens occupy the KV cache before the first text token:
      // ?visionTokens=N (explicit) or ?imgRes=<preset>&imgN=<count> resolve to
      // a total vision-token estimate that is added to contextLength for KV
      // math. Absent → byte-identical legacy all-text behavior.
      const vision = resolveVisionInputs(params);
      let kvInputs = inputs;
      if (vision) {
        kvInputs = { ...inputs, visionTokens: vision.visionTokens };
        kvInputs.contextLength = inputs.contextLength + vision.visionTokens;
      }

      // Context-window check (#828): mirrors /api/vram's contextWindow
      // (withinLimit / overflowTokens) against the architecture's own
      // max_position_embeddings, evaluated over the EFFECTIVE cache context
      // (text + vision tokens, which occupy the cache too). Generic geometry
      // has no known limit → null.
      const maxCtx = preset?.maxContext ?? null;
      let withinLimit = maxCtx == null ? null : kvInputs.contextLength <= maxCtx;
      let overflowTokens = maxCtx != null ? Math.max(0, kvInputs.contextLength - maxCtx) : null;
      if (withinLimit === false) {
        warnings.push({
          code: 'context_exceeds_model_limit',
          message: vision
            ? `contextLength ${kvInputs.contextLength.toLocaleString('en-US')} (${inputs.contextLength.toLocaleString('en-US')} text + ${vision.visionTokens.toLocaleString('en-US')} vision) exceeds ${inputs.architecture}'s maximum context of ${maxCtx.toLocaleString('en-US')} by ${overflowTokens.toLocaleString('en-US')} tokens — the result is a hypothetical, not a runnable configuration`
            : `contextLength ${inputs.contextLength.toLocaleString('en-US')} exceeds ${inputs.architecture}'s maximum context of ${maxCtx.toLocaleString('en-US')} by ${overflowTokens.toLocaleString('en-US')} tokens — the result is a hypothetical, not a runnable configuration`
        });
      }

      // Downgrade signal (#601, reconciled with #764): an unrecognized
      // architecture id silently falls back to generic GQA geometry; say so
      // instead of returning a plausible-looking 200 with no trace of the
      // substitution. Surfaced on the dry_run path too.
      if (presetKey && !preset) {
        warnings.push({
          code: 'architecture_unknown_generic_fallback',
          message: `Unknown architecture '${presetKey}' — computed with generic GQA geometry (${inputs.numLayers} layers × ${inputs.kvHeads} KV heads × ${inputs.headDim} dim). Pass numLayers/kvHeads/headDim explicitly for non-GQA or newer architectures. Valid ids: ${Object.keys(MODEL_PRESETS).join(', ')}.`
        });
      }

      if (dryRun) {
        const body = withId('kvCache', kvInputs, null, true, subs).body;
        if (warnings.length) body.warnings = warnings;
        return { status: 200, body };
      }

      const result = {
        ...kvCache(kvInputs),
        warnings, // always present (#798) — ComputeResult requires it
        ...(maxCtx != null ? { contextWindow: { maxPositionEmbeddings: maxCtx, requested: kvInputs.contextLength, withinLimit, overflowTokens } } : {})
      };
      if (vision) {
        result.vision = {
          ...vision,
          textContextLength: inputs.contextLength,
          totalKvContextLength: kvInputs.contextLength,
          note: 'vision tokens are prefilled before the first text token and occupy the KV cache for the whole turn; contextLength above includes them'
        };
      }
      // Auditability (#764): echo the id the caller actually sent alongside
      // the resolved geometry inputs.
      if (presetKey) result.inputs.requestedArchitecture = presetKey;
      return withId('kvCache', kvInputs, result, dryRun, subs);
    }

    case 'flagged': {
      // Engine flag modeling (issue #70): apply documented llama.cpp/vLLM
      // flag deltas to base speeds, then simulate a single turn with them.
      // The response carries a per-flag audit trail (delta + source tag) so
      // agents can see exactly how each number was adjusted.
      const flags = params.flags ?? '';
      // Resolved inputs: the id is hashed over THESE (#1020), like every
      // other branch — explicit defaults and flag spelling must not mint a
      // different citation id for an identical computation.
      const inputs = {
        prefillSpeed: num(params.prefillSpeed, 3800, 'prefillSpeed'),
        decodeSpeed: num(params.decodeSpeed, 105, 'decodeSpeed'),
        promptTokens: num(params.promptTokens, 2048, 'promptTokens'),
        outputTokens: num(params.outputTokens, 512, 'outputTokens'),
        flags
      };
      // Validate flags on BOTH paths (#871): run the same applyEngineFlags
      // pass the real call uses so a dry run surfaces unknown ids and unmet
      // flag dependencies (warnings[]) instead of echoing garbage clean.
      const flaggedInputs = applyEngineFlags({
        prefillSpeed: inputs.prefillSpeed,
        decodeSpeed: inputs.decodeSpeed,
        flags
      });
      if (dryRun) {
        // #871 + #385: dry run surfaces BOTH the flag-validation warnings[]
        // and the input-substitution warnings, and echoes the RESOLVED
        // (applied) flag ids exactly like the real call. The id stays the
        // #1020 hash of the resolved raw-spelling inputs.
        const dry = withId('flagged', inputs, null, true, subs).body;
        const flaggedEcho = dryRunBody('flagged', {
          ...flaggedInputs.inputs,
          promptTokens: inputs.promptTokens,
          outputTokens: inputs.outputTokens
        });
        return { status: 200, body: {
          ...dry,
          ...flaggedEcho,
          warnings: [
            ...(subs.length ? inputSubstitutionWarnings(subs) : []),
            ...(Array.isArray(flaggedInputs.warnings) ? flaggedInputs.warnings : [])
          ]
        } };
      }
      return withId('flagged', inputs, {
        inputs: { ...flaggedInputs.inputs, promptTokens: inputs.promptTokens, outputTokens: inputs.outputTokens },
        adjusted: flaggedInputs.adjusted,
        totalPrefillDeltaPct: flaggedInputs.totalPrefillDeltaPct,
        totalDecodeDeltaPct: flaggedInputs.totalDecodeDeltaPct,
        adjustments: flaggedInputs.adjustments,
        warnings: flaggedInputs.warnings,
        simulation: singleTurn({
          promptTokens: inputs.promptTokens,
          outputTokens: inputs.outputTokens,
          prefillSpeed: flaggedInputs.adjusted.prefillSpeed,
          decodeSpeed: flaggedInputs.adjusted.decodeSpeed
        })
      }, false, subs);
    }

    case 'cost': {
      const { speeds: cSpeeds } = resolveHardwarePreset(params);
      const costInputs = {
        hardwarePriceUsd: num(params.hardwarePriceUsd ?? params.price, 0, 'hardwarePriceUsd'),
        electricityRatePerKwh: num(params.electricityRatePerKwh ?? params.electricityRate, 0.15, 'electricityRatePerKwh'),
        powerDrawWatts: num(params.powerDrawWatts, 0, 'powerDrawWatts'),
        amortizationMonths: num(params.amortizationMonths, 36, 'amortizationMonths'),
        promptTokens: num(params.promptTokens, 2048, 'promptTokens'),
        outputTokens: num(params.outputTokens, 512, 'outputTokens'),
        prefillSpeed: num(params.prefillSpeed, cSpeeds.prefillSpeed ?? 3800, 'prefillSpeed'),
        decodeSpeed: num(params.decodeSpeed, cSpeeds.decodeSpeed ?? 105, 'decodeSpeed')
      };
      // Aliases are resolved into costInputs BEFORE hashing (#1020), so the
      // documented `price=`/`electricityRate=` spellings and the canonical
      // ones mint the same id. Same id as dry_run (#17/#1020).
      if (dryRun) return withId('cost', costInputs, null, true, subs);
      // #736: bare model=cost calls default price AND power to 0, which makes
      // every operating-cost figure come out $0.00 — flag the unset inputs so
      // the result can't be mistaken for a real quote.
      const warnings = [];
      if (costInputs.hardwarePriceUsd === 0) {
        warnings.push({
          code: 'cost_hardware_price_unset',
          message: 'hardwarePriceUsd=0 (default) — hardware amortization contributes nothing; pass ?hardwarePriceUsd= for a total-cost-of-ownership figure.'
        });
      }
      if (costInputs.powerDrawWatts === 0) {
        warnings.push({
          code: 'cost_power_draw_unset',
          message: 'powerDrawWatts=0 (default) — electricity contributes nothing; pass ?powerDrawWatts= for a realistic $/1M tokens.'
        });
      }
      return withId('cost', costInputs, withPresetMeta(params, { ...cost(costInputs), warnings }), false, subs);
    }

    case '':
    case undefined:
      return { status: 200, body: capabilityList() };

    default:
      throw new ApiError('INVALID_PARAMS', `Unknown model '${model}'`, {
        extras: { available: ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache', 'flagged', 'cost'] }
      });
  }
}

function capabilityList() {
  return {
    description: 'LLM inference math API. Pass ?model=<name> plus parameters, or batch up to 50 parameter sets via POST {"batch":[...]} (or ?batch=[...] as JSON). Speed-based models accept ?preset=<hardware preset id> from /api/presets to source prefillSpeed/decodeSpeed defaults (explicit params win; unknown ids get an unknown_preset warning). singleTurn/agentic also accept optional SLO budgets maxTtftSeconds/maxTpotMs and return a pass/fail `slo` block (#472/#480).',
    models: {
      singleTurn: { params: ['promptTokens', 'outputTokens', 'prefillSpeed', 'decodeSpeed', '?preset', '?jit&jitPct', '?ctx&ctxHalf', '?img&imgN&imgRes', '?maxTtftSeconds&maxTpotMs'], example: '/api/compute?model=singleTurn&promptTokens=4096&outputTokens=512&prefillSpeed=3800&decodeSpeed=105' },
      speculative: { params: ['baseDecodeSpeed', 'draftTokens', 'acceptanceRate', 'draftCostFraction'], example: '/api/compute?model=speculative&baseDecodeSpeed=105&draftTokens=4&acceptanceRate=0.7' },
      batched: {
        params: ['prefillSpeed', 'decodeSpeed', 'batchSize', 'promptTokens', 'outputTokens', 'decodeDecayExponent'],
        scheduleParams: ['numRequests (1-50, default batchSize)', 'maxBatchSize (default batchSize)', 'chunkTokens (0 = chunked prefill off, default 512)', 'arrivalIntervalMs (default 0)', 'seed (default 42)'],
        note: 'Passing any scheduling param switches the response from the B^0.25 aggregate curve to a per-engine-step schedule (see the simulation block), matching the Batching view (#529).',
        example: '/api/compute?model=batched&batchSize=16&decodeSpeed=105'
      },
      agentic: {
        params: ['numTurns', 'basePromptTokens', 'toolOutputTokensPerTurn', 'decodeTokensPerTurn', 'prefillSpeed', 'decodeSpeed', 'enablePrefixCaching', '?preset', '?maxTtftSeconds&maxTpotMs'],
        optionalParams: ['contextWindowTokens', 'sloTtftSec', 'sloTpotMs', 'sloTurnWalltimeSec', 'sloWalltimeSec'],
        response: '{ turns: [{ turn, totalPromptTokens, newTokensPrefilled, isCached, prefillSeconds, decodeSeconds, turnWalltimeSeconds, cumulativeWalltimeSeconds }], finalContextTokens, totalWalltimeSeconds, walltimeWithoutCachingSeconds, cachingSavesSeconds, cachingSavesPct, contextWindowTokens?, firstContextOverflowTurn?, slo? }',
        description: 'Turn-by-turn walltime for a tool-calling loop, with/without prefix caching. Optional: &contextWindowTokens=<tokens> adds firstContextOverflowTurn (first turn whose prompt+output exceeds the window; null when it fits) plus a context_window_overflow warning. Optional SLO budgets: &sloTtftSec / &sloTpotMs / &sloTurnWalltimeSec / &sloWalltimeSec add a slo block — per-turn {ttft,tpot,walltime} verdicts with pass/marginPct (same margin convention as the UI badges), failingTurns, worstTurn and a whole-loop verdict.',
        example: '/api/compute?model=agentic&numTurns=6&enablePrefixCaching=true'
      },
      kvCache: { params: ['architecture|numLayers+kvHeads+headDim', 'contextLength', 'precisionBytes', 'batchSize'], architectures: Object.keys(MODEL_PRESETS), example: '/api/compute?model=kvCache&architecture=llama70b&contextLength=65536' },
      flagged: {
        params: ['prefillSpeed', 'decodeSpeed', 'promptTokens', 'outputTokens', 'flags'],
        flags: Object.fromEntries(ENGINE_FLAGS.map(f => [f.id, { flag: f.flag, engine: f.engine, prefillDeltaPct: Math.round((f.prefillMult - 1) * 100), decodeDeltaPct: Math.round((f.decodeMult - 1) * 100), kvBits: f.kvBits, source: f.source, sourceNote: f.sourceNote }])),
        description: 'Applies documented engine launch-flag deltas to base speeds and simulates a single turn. All deltas are heuristics with a source note each — not measurements.',
        example: '/api/compute?model=flagged&prefillSpeed=2400&decodeSpeed=65&flags=flash-attn,kv-q8'
      },
      cost: { params: ['hardwarePriceUsd', 'electricityRatePerKwh', 'powerDrawWatts', 'amortizationMonths', 'promptTokens', 'outputTokens', 'prefillSpeed', 'decodeSpeed'], example: '/api/compute?model=cost&hardwarePriceUsd=2000&electricityRatePerKwh=0.15&powerDrawWatts=450&prefillSpeed=3800&decodeSpeed=105' }
    },
    batch: {
      description: 'Compare variants in one call: POST {"batch": [{"model": "singleTurn", "promptTokens": 4096}, ...]}. Each item is a normal parameter set including its own "model" field, plus an optional opaque "label" string (≤200 chars) echoed back on results[i] for result→input attribution (#626). Partial failure returns 200 with { results: [{ index, ok, result | code+status+type+error }] } — one bad item does not fail the batch. Failed entries echo their input ("inputs", or "input" for non-object items) and carry a deterministic per-item id plus ApiError extras such as available[], so a subset retry can be correlated by id instead of index. All-failed batches return the same 200 envelope (a subset retry of just the failed items is itself all-failed), each entry carrying its stable code/status/type. Optionally pass a top-level "batchId" string to pin the response id across subset retries: every attempt under the same batchId returns the same id, verifiable via /api/calc/<id>?batchId=<batchId>.',
      maxSize: MAX_BATCH_SIZE,
      example: { batch: [{ model: 'singleTurn', promptTokens: 4096 }, { model: 'kvCache', architecture: 'llama70b', contextLength: 131072 }] }
    },
    sanity: {
      description: 'Non-blocking implausibility warnings. Every successful result carries a "warnings" array (empty when inputs are plausible) flagging outputs that violate known physical bounds: decode above the memory-bandwidth roofline, prefill above the compute roofline, TTFT below the kernel-launch floor, (kvCache) a contextLength beyond the architecture max context, or token counts below 1 / above 1e9 (#550, emitted as tokens_implausible; agentic ?contextWindowTokens= overflow emits context_window_overflow). A present-but-unparseable numeric parameter (e.g. promptTokens=abc) additionally emits input_not_numeric_default_used naming the parameter, the requested value and the substituted default (#385); agentic ?contextWindowTokens= overflow emits context_window_overflow. Warnings never change the math or the HTTP status.',
      codes: ['decode_above_bandwidth_roofline', 'prefill_above_compute_roofline', 'ttft_below_kernel_launch_floor', 'context_exceeds_model_limit'],
      example: '/api/compute?model=singleTurn&promptTokens=64&prefillSpeed=900000&decodeSpeed=5000'
    },
    dryRun: {
      description: 'Add &dry_run=true (or "dry_run": true in a POST body) to validate a request and echo the parsed parameters (defaults filled in, numbers coerced) WITHOUT executing any math — a cheap sanity check for agents debugging malformed payloads. Works on GET and POST, and applies per-item inside a batch. The response carries the same deterministic id the real call would return. Unknown models and malformed batches fail exactly as they would for a real call.',
      response: '{ dry_run: true, model, inputs, id?, note }',
      example: '/api/compute?model=agentic&numTurns=6&enablePrefixCaching=true&dry_run=true'
    },
    otherEndpoints: OTHER_ENDPOINTS
  };
}

// Batch payload: an array of parameter sets, accepted as
//   POST { "batch": [...] }   (also "variants" as an alias)
//   GET  /api/compute?batch=[{"model":"..."},...]   (URL-encoded JSON)
// Partial failure keeps 200 with per-item ok/error entries so one bad
// scenario never fails the whole comparison (#68/#707) — including the
// all-failed case: a subset retry of just the failed items (#964) is itself
// an all-failed batch and MUST come back as a 200 envelope with per-item
// entries. Each failed entry still carries the full problem identity
// (`code`, HTTP `status`, RFC 9457 `type`) so transport-level consumers
// (monitors, retries, caching) can branch without prose-matching.
function runBatch(rawItems, dryRun = false) {
  let items = rawItems;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      throw new ApiError('INVALID_PARAMS', 'batch must be a JSON array of parameter sets (could not parse batch as JSON)');
    }
  }

  if (!Array.isArray(items)) {
    throw new ApiError('INVALID_PARAMS', 'batch must be a JSON array of parameter sets');
  }
  if (items.length === 0) {
    throw new ApiError('INVALID_PARAMS', 'batch must contain at least one parameter set');
  }
  if (items.length > MAX_BATCH_SIZE) {
    throw new ApiError('INVALID_PARAMS', `batch exceeds maximum of ${MAX_BATCH_SIZE} parameter sets (got ${items.length})`, {
      extras: { maxSize: MAX_BATCH_SIZE }
    });
  }

  const results = items.map((item, index) => {
    // Failed entries carry the full problem identity (stable `code`, HTTP
    // `status`, RFC 9457 `type` URI) so agents branch without prose-matching
    // the `error` field (#707).
    const failure = (code, error, statusOverride) => ({
      index,
      ok: false,
      code,
      status: statusOverride ?? ERROR_CODES[code]?.status ?? 500,
      type: problemType(code),
      error
    });
    // Issue #626: echo an optional opaque `label` back on the result entry so
    // agents can attribute results to inputs without relying on array order
    // alone (order breaks silently when an item errors or is reordered).
    // Capped like X-Request-Id; non-string values are ignored, not rejected.
    const label = typeof item?.label === 'string' && item.label.length > 0
      ? { label: item.label.slice(0, 200) }
      : {};
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      // #964: echo the offending value so a response held in isolation (async
      // processing, log inspection, forwarded result) still says WHAT failed,
      // not just where. Carries the full problem identity (code/status/type).
      return {
        ...failure('INVALID_PARAMS', 'batch item must be an object with a "model" field'),
        ...label,
        input: item ?? null
      };
    }
    // #964: every object item carries a deterministic per-item id hashed from
    // its content. A failed item keeps this id across subset retries, so
    // attempt N+1 can be correlated to attempt N without trusting positional
    // indexes (which renumber when only the failed subset is resent).
    const itemId = computeCalcId('compute', { model: item.model || item.m || '', ...item });
    try {
      const { status, body } = computeOne(item, dryRun);
      // Stamp schema_version + the same deterministic calc id an individual
      // call would get, so batch results match standalone calls (#68).
      if (status === 200) return { index, ...label, ok: true, result: { id: itemId, ...withSchemaVersion(body) } };
      return {
        ...failure(body?.code || 'INTERNAL', body?.detail || body?.title || body?.error || 'unknown error', status),
        ...label,
        id: itemId,
        inputs: item, // #964: echo the failed input
        ...(body?.available ? { available: body.available } : {}) // #964
      };
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      return {
        ...(apiErr
          ? failure(err.code, String(err.message || err), err.status)
          : failure('INTERNAL', String(err.message || err))),
        ...label,
        id: itemId,
        inputs: item, // #964: echo the failed input
        ...(apiErr?.extras ?? {}) // #964: preserve available[] and other extras
      };
    }
  });

  const okCount = results.filter(r => r.ok).length;
  const errorCount = results.length - okCount;

  return {
    status: 200,
    body: {
      batch: true,
      count: results.length,
      okCount,
      errorCount,
      results
    }
  };
}

/**
 * Shared core for /api/compute and /api/calc/<id> replay (issue #68).
 * Returns { status, body }; successful bodies carry a deterministic `id`
 * hashed from the resolved request (aliases collapsed, defaults filled in —
 * #68/#1020).
 */
export function computeBody(params = {}) {
  // dry_run mode (#17): validate + echo parsed params without executing.
  // Applies to single calls and per-item inside a batch alike.
  const dryRun = isDryRun(params);

  // Batched mode: ?batch=[...] / POST {"batch":[...]} ("variants" alias)
  const rawBatch = params.batch ?? params.variants;
  if (rawBatch !== undefined) {
    const out = runBatch(rawBatch, dryRun);
    // Stamp the deterministic replay id on every 200 envelope — including
    // all-error ones, since a subset retry of just the failed items (#964)
    // is itself an all-error batch and still needs its correlation id.
    // A caller-supplied
    // `batchId` (#964) pins the top-level batch id — it hashes ONLY the
    // batchId string, so resending any subset of the batch's items under the
    // same batchId mints the SAME id instead of a fresh one. Without batchId
    // the id covers the PARSED items (#942), so the GET-string and POST-array
    // spellings of one logical batch mint the SAME id instead of disagreeing
    // over transport spelling.
    if (out.status === 200 && out.body) {
      const rawBatchId = params.batchId;
      const batchId = rawBatchId !== undefined && rawBatchId !== null && rawBatchId !== '' && typeof rawBatchId !== 'object'
        ? String(rawBatchId)
        : null;
      if (batchId) {
        out.body.id = computeCalcId('compute', { batchId });
        out.body.batchId = batchId;
      } else {
        let items = rawBatch;
        if (typeof items === 'string') {
          try { items = JSON.parse(items); } catch { /* runBatch already rejected unparseable strings */ }
        }
        const idParams = { ...params, [params.batch !== undefined ? 'batch' : 'variants']: items };
        out.body.id = Array.isArray(items) ? computeCalcId('compute', idParams) : computeCalcId('compute', params);
      }
    }
    return out;
  }

  try {
    const out = computeOne(params, dryRun);
    if (out.status === 200 && out.body) {
      out.body = { id: computeCalcId('compute', { model: params.model || params.m || '', ...params }), ...out.body };
    }
    return out;
  } catch (err) {
    // Let ApiErrors reach the handler's problem+json renderer untouched.
    if (err instanceof ApiError) throw err;
    return { status: 500, body: { error: String(err.message || err) } };
  }
}

export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    applySchemaHeaders(res);
    return res.status(204).end();
  }
  if (!enforceRateLimit(req, res)) return;

  // Accept both GET (?model=singleTurn&promptTokens=...) and POST (JSON body).
  // Malformed / non-object bodies are client errors: normalize them into a
  // 400 problem+json instead of the historical off-contract failure
  // (issue #537).
  let params;
  try {
    params = req.method === 'POST' ? normalizeJsonBody(req.body) : req.query;
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }

  try {
    const { status, body } = computeBody(params);
    return json(res, body, status);
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}

/**
 * Normalize a POST body into a plain parameter object (issue #537):
 *  - absent/empty body → {} (same as before);
 *  - a string body (how unparsed/malformed JSON arrives from some runtimes)
 *    is JSON.parse'd; a parse failure throws INVALID_PARAMS (400);
 *  - any non-object body (array, number, boolean, null-after-parse) throws
 *    INVALID_PARAMS (400) — previously `[] fell through to a 200 capability
 *    index and a malformed string produced an off-contract 500.
 */
export function normalizeJsonBody(body) {
  if (body === undefined || body === null) return {};
  let parsed = body;
  if (typeof body === 'string') {
    const raw = body.trim();
    if (!raw) return {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApiError('INVALID_PARAMS', 'request body must be valid JSON (could not parse the request body)');
    }
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('INVALID_PARAMS', 'request body must be a JSON object mapping parameter names to values');
  }
  return parsed;
}
