// GET/POST /api/vram — combined model + KV-cache + context VRAM estimate from
// a bare { hfId, context, quant }. Architecture (layers, hidden dim, GQA
// heads, head dim) and weight size are resolved automatically, so agents
// never guess model internals. Resolution tiers (issue #68):
//   1. built-in lookup table for common families (llama*, qwen3*, gemma*,
//      mistral*) — offline and deterministic (_hflookup.js)
//   2. huggingface.co config.json / GGUF header for everything else
//      (_hfconfig.js)
//   3. name-tag heuristic ("Foo-13B" → ~13B bucketed arch) when HF is
//      unreachable or gated — coarse, and flagged in model.resolutionSource
//      and model.notes
//
//   /api/vram?hfId=meta-llama/Llama-3.1-8B-Instruct&context=65536&quant=q4_k_m
//   /api/vram?hfId=...&context=...&vramGb=24            → fits + max context
//   /api/vram?hfId=...&numTurns=40&tokensPerTurn=1200   → per-turn KV growth
//                                                          with overflow turns
//
// Units (#738 #866): every memory figure in the response is GiB (binary,
// 1024-based), never decimal GB. The response states this explicitly in its
// top-level `units` block so agents budgeting against spec-sheet decimal-GB
// numbers can't mis-read it.

import { resolveModel } from '../_hfconfig.js';
import { resolveQuant } from '../_quant.js';
import { lookupHfArch, guessArchFromName } from '../_hflookup.js';
import { ApiError, sendProblem, sendProblemFromError } from '../_errors.js';

export const config = { runtime: 'nodejs' };

const GB = 1024 ** 3;

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.end(JSON.stringify(body, null, 2));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(x) {
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 1e6) / 1e6;
}

// Mirror of _hfconfig.js's id cleanup (strip full huggingface.co URLs and
// trailing slashes) for the offline tiers.
function normalizeHfId(hfIdRaw) {
  return String(hfIdRaw || '').trim().replace(/^https?:\/\/huggingface\.co\//, '').replace(/\/+$/, '');
}

async function estimate(params) {
  const hfId = params.hfId ?? params.model ?? params.repo;
  if (!hfId) {
    // RFC 9457 problem+json (#539): the stable `code` is what agents branch
    // on; the parameter list and examples ride along as extra members so
    // nothing discoverable is lost versus the old ad-hoc {error} shape.
    throw new ApiError(
      'INVALID_PARAMS',
      'missing hfId — pass ?hfId=org/model (e.g. meta-llama/Llama-3.1-8B-Instruct)',
      {
        extras: {
          params: ['hfId (required)', 'context (tokens, default 32768)', 'quant (default q4_k_m)',
            'batchSize (default 1)', 'kvPrecisionBytes (default 2 = FP16)', 'vramGb (optional budget)',
            'numTurns + tokensPerTurn (optional per-turn KV projection)'],
          examples: [
            '/api/vram?hfId=meta-llama/Llama-3.1-8B-Instruct&context=65536&quant=q4_k_m',
            '/api/vram?hfId=Qwen/Qwen2.5-32B&context=131072&quant=q4_k_m&vramGb=24'
          ]
        }
      }
    );
  }

  // Resolution tiers (issue #68): built-in table → Hugging Face → name
  // heuristic. The table keeps common families (llama*/qwen3*/gemma*/mistral*)
  // offline and deterministic; the network paths cover everything else.
  const local = lookupHfArch(hfId);
  let resolved;
  if (local) {
    resolved = { hfId: normalizeHfId(hfId), ...local };
  } else {
    try {
      resolved = await resolveModel(hfId, { quant: params.quant ?? params.q }); // throws tagged httpErrors
      resolved.resolutionSource = 'huggingface';
    } catch (err) {
      // "Caller got the id wrong" errors pass through untouched; only
      // environmental failures (502 HF unreachable, 403 gated/no files,
      // 422 unparseable header) fall back to the coarse name-tag heuristic.
      const status = Number(err?.status);
      if (status === 400 || status === 404 || !Number.isInteger(status)) throw err;
      const guess = guessArchFromName(hfId);
      if (!guess) throw err;
      resolved = { hfId: normalizeHfId(hfId), ...guess };
    }
  }
  resolved.resolutionSource ??= resolved.source ?? 'huggingface';
  const quant = resolveQuant(params.quant ?? params.q);

  // #646: numeric params are validated at the boundary — unparseable or
  // out-of-range values fall back LOUDLY (additive warnings[]) instead of
  // silently rewriting inputs. Clean calls emit no warnings field at all,
  // so existing consumers see byte-identical responses.
  const warnings = [];
  const numInput = (raw, fallback, name) => {
    if (raw == null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      warnings.push({
        code: 'input_coerced_to_default',
        message: `${name}='${raw}' is not a finite number — using default ${fallback}`
      });
      return fallback;
    }
    return n;
  };
  const clampMin = (parsed, raw, min, name) => {
    if (!warnings.some(w => w.message.startsWith(`${name}=`)) && parsed < min) {
      warnings.push({
        code: 'input_clamped_to_minimum',
        message: `${name}=${raw} is below the minimum of ${min} — using ${min}`
      });
      return min;
    }
    return parsed;
  };

  const context = clampMin(Math.round(numInput(params.context ?? params.contextLength, 32768, 'context')),
    params.context ?? params.contextLength, 1, 'context');
  const batchSize = clampMin(Math.round(numInput(params.batchSize, 1, 'batchSize')),
    params.batchSize, 1, 'batchSize');
  // #646: kvPrecisionBytes <= 0 previously produced negative/zero KV caches
  // and false fits:true — non-finite/non-positive values now use the
  // documented default (2 = FP16) with an explicit warning.
  let kvPrecisionBytes = num(params.kvPrecisionBytes, null);
  if (kvPrecisionBytes == null) {
    // param absent — documented default
    kvPrecisionBytes = 2;
  } else if (!(kvPrecisionBytes > 0)) {
    warnings.push({
      code: 'kv_precision_bytes_invalid',
      message: `kvPrecisionBytes='${params.kvPrecisionBytes}' must be a finite number > 0 — using default 2`
    });
    kvPrecisionBytes = 2;
  }

  // Framework-overhead knob (#819): previously ?overheadFraction= was silently
  // ignored and total.breakdown carried no overhead component at all. When the
  // caller passes a fraction in [0,1], weights+KV are scaled by (1+f) —
  // matching how /api/sizing and the UI ledger reserve framework headroom
  // (vLLM PagedAttention tables, CUDA context, activation buffers). Absent →
  // legacy behavior byte-stable, with overheadModel:'none' + isUpperBound so
  // the omission is machine-readable instead of prose-only.
  let overheadFraction = null;
  if (params.overheadFraction != null && params.overheadFraction !== '') {
    const f = Number(params.overheadFraction);
    if (!Number.isFinite(f) || f < 0 || f > 1) {
      return {
        status: 400,
        body: {
          error: `invalid overheadFraction '${params.overheadFraction}' — pass a fraction in [0, 1] (e.g. 0.25 reserves 25% of weights+KV for framework overhead; vLLM gpu_memory_utilization=0.9 ≈ 0.11)`
        }
      };
    }
    overheadFraction = f;
  }
  const overheadMultiplier = overheadFraction != null ? 1 + overheadFraction : 1;

  const { architecture: arch } = resolved;

  // Weights: params × quant bytes when we have a parameter count; otherwise
  // the GGUF file size (already quantized at repo precision).
  const weights = resolved.paramsTotal != null
    ? {
        gb: round((resolved.paramsTotal * quant.bytesPerParam) / GB),
        source: `${resolved.paramsTotal.toLocaleString('en-US')} params × ${quant.bpw} bpw`,
        sourceKind: 'params×quant'
      }
    : {
        gb: resolved.weightsFileBytes != null ? round(resolved.weightsFileBytes / GB) : null,
        source: resolved.weightsSource,
        sourceKind: 'file-size'
      };

  // KV cache: 2 (K+V) × layers × kvHeads × headDim × precision × tokens × batch
  const bytesPerToken = 2 * arch.numLayers * arch.kvHeads * arch.headDim * kvPrecisionBytes;
  const kvBytesTotal = bytesPerToken * context * batchSize;

  const weightsGb = weights.gb;
  const kvGb = round(kvBytesTotal / GB);
  const baseGb = weightsGb != null ? weightsGb + kvGb : null;
  const overheadGb = baseGb != null && overheadFraction != null ? round(baseGb * overheadFraction) : null;
  const totalGb = baseGb != null ? round(baseGb * overheadMultiplier) : null;

  // Context-window check against the model's own max_position_embeddings.
  const maxCtx = arch.maxContextLength;
  const contextWindow = {
    maxPositionEmbeddings: maxCtx,
    requested: context,
    withinLimit: maxCtx == null ? null : context <= maxCtx,
    overflowTokens: maxCtx != null ? Math.max(0, context - maxCtx) : null
  };

  // Optional VRAM budget → does it fit, and what context would fit instead?
  // #646: an unparseable budget is no longer silently dropped (which looked
  // identical to not passing one) — it emits a vram_budget_ignored warning.
  const vramRaw = params.vramGb;
  let vramGb = num(vramRaw, null);
  if (vramGb == null && vramRaw != null && vramRaw !== '') {
    warnings.push({
      code: 'vram_budget_ignored',
      message: `vramGb='${vramRaw}' is not a finite number — budget check skipped (fits will be null)`
    });
  }
  let fits = null;
  if (vramGb != null && totalGb != null) {
    const budgetBytes = vramGb * GB;
    const bytesPerCtxToken = bytesPerToken * batchSize;
    fits = {
      vramGb,
      fits: totalGb <= vramGb,
      headroomGb: round(vramGb - totalGb),
      maxContextTokens: bytesPerCtxToken > 0
        ? Math.max(0, Math.floor(((budgetBytes / overheadMultiplier) - weightsGb * GB) / bytesPerCtxToken))
        : null,
      note: overheadFraction != null
        ? `headroom and maxContextTokens reserve ${Math.round(overheadFraction * 100)}% framework overhead (overheadFraction=${overheadFraction})`
        : 'maxContextTokens ignores activation/overhead — treat as an upper bound'
    };
  }

  // Optional agentic projection: KV growth per turn with the exact turn where
  // the context window or the VRAM budget is first exceeded.
  let projection = null;
  const numTurns = params.numTurns != null ? Math.round(num(params.numTurns, 0)) : 0;
  const tokensPerTurn = params.tokensPerTurn != null ? num(params.tokensPerTurn, 0) : 0;
  if (numTurns > 0 && tokensPerTurn > 0) {
    const turns = [];
    let firstContextOverflowTurn = null;
    let firstVramOverflowTurn = null;
    for (let turn = 1; turn <= Math.min(200, numTurns); turn++) {
      const ctxTokens = context + tokensPerTurn * (turn - 1);
      const turnKvGb = round((bytesPerToken * ctxTokens * batchSize) / GB);
      const turnTotalGb = weightsGb != null ? round(weightsGb + turnKvGb) : null;
      const ctxOverflow = maxCtx != null && ctxTokens > maxCtx;
      const vramOverflow = fits?.vramGb != null && turnTotalGb != null && turnTotalGb > fits.vramGb;
      if (ctxOverflow && firstContextOverflowTurn == null) firstContextOverflowTurn = turn;
      if (vramOverflow && firstVramOverflowTurn == null) firstVramOverflowTurn = turn;
      turns.push({ turn, contextTokens: ctxTokens, kvGb: turnKvGb, totalGb: turnTotalGb,
        overflow: vramOverflow && ctxOverflow ? 'context+vram' : vramOverflow ? 'vram' : ctxOverflow ? 'context' : null });
    }
    projection = {
      tokensPerTurn,
      numTurns: turns.length,
      // (#651) Echo what was asked and flag the silent 200-turn window cap so
      // a "no overflow" verdict can't be read as covering an unprojected tail.
      requestedNumTurns: numTurns,
      ...(numTurns > turns.length
        ? {
            truncated: true,
            note: `projection window capped at ${turns.length} of ${numTurns} requested turns — first*OverflowTurn verdicts cover only the projected window`
          }
        : {}),
      perTurnKvGb: round((bytesPerToken * tokensPerTurn * batchSize) / GB),
      turns,
      firstContextOverflowTurn,
      firstVramOverflowTurn
    };
  }

  return {
    status: 200,
    body: {
      units: {
        memory: 'GiB',
        note: 'all memory figures (weights, KV cache, totals, headroom, vramGb budgets) are GiB — binary, 1024-based, NOT decimal GB',
        kvRate: 'bytes/token'
      },
      inputs: {
        hfId: resolved.hfId, context, quant: params.quant ?? 'q4_k_m',
        resolvedQuant: quant.key, quantAssumed: quant.assumed,
        batchSize, kvPrecisionBytes,
        ...(overheadFraction != null ? { overheadFraction } : {}),
        ...(vramGb != null ? { vramGb } : {})
      },
      // #646: present only when a numeric input was rewritten or ignored.
      ...(warnings.length ? { warnings } : {}),
      // #637: fit-model provenance — /api/sizing answers the same fit
      // question with its own bpw table (4.25 fallback vs 4.85 here),
      // bucket-guessed architectures and a flat +1.5 GB overhead. These
      // fields let an agent detect and reconcile that divergence instead of
      // trusting two contradictory verdicts blind.
      fitAssumptions: {
        bpw: quant.bpw,
        bpwSource: quant.assumed ? 'assumed-fallback' : 'quant-table',
        archSource: resolved.resolutionSource,
        overheadModel: 'none',
        overheadNote: 'no activation/runtime overhead added; /api/sizing adds a flat 1.5 GB'
      },
      // #646: present only when a numeric input was rewritten or ignored.
      ...(warnings.length ? { warnings } : {}),
      // #637: fit-model provenance — /api/sizing answers the same fit
      // question with its own bpw table (4.25 fallback vs 4.85 here),
      // bucket-guessed architectures and a flat +1.5 GB overhead. These
      // fields let an agent detect and reconcile that divergence instead of
      // trusting two contradictory verdicts blind.
      fitAssumptions: {
        bpw: quant.bpw,
        bpwSource: quant.assumed ? 'assumed-fallback' : 'quant-table',
        archSource: resolved.resolutionSource,
        overheadModel: 'none',
        overheadNote: 'no activation/runtime overhead added; /api/sizing adds a flat 1.5 GB'
      },
      model: {
        hfId: resolved.hfId,
        family: resolved.family,
        resolutionSource: resolved.resolutionSource,
        architecture: arch,
        paramsTotal: resolved.paramsTotal,
        paramsB: resolved.paramsTotal != null ? round(resolved.paramsTotal / 1e9) : null,
        notes: [...resolved.notes, ...(quant.assumed ? [`unknown quant '${quant.key}' — assumed ~4.85 bpw`] : [])]
      },
      weights: {
        ...weights,
        quant: quant.key,
        bytesPerParam: round(quant.bytesPerParam)
      },
      kvCache: {
        bytesPerToken,
        kbPerToken: round(bytesPerToken / 1024),
        mbPerToken: round(bytesPerToken / (1024 ** 2)),
        gbAtContext: kvGb,
        formula: `2 × ${arch.numLayers} layers × ${arch.kvHeads} KV heads × ${arch.headDim} dim × ${kvPrecisionBytes}B × ${context.toLocaleString('en-US')} ctx × ${batchSize} batch`
      },
      total: {
        gb: totalGb,
        breakdown: weightsGb != null
          ? {
              weightsGb,
              kvCacheGb: kvGb,
              // #819: framework reserve is 0 unless ?overheadFraction= is passed.
              frameworkOverheadGb: overheadGb ?? 0
            }
          : { weightsGb: null, kvCacheGb: kvGb, note: 'weight size unresolvable for this repo' }
      },
      // #819: machine-readable statement of which overhead model produced
      // these numbers ('none' = weights+KV only — an upper bound; 'fraction' =
      // (weights+KV) × (1 + inputs.overheadFraction)).
      overheadModel: overheadFraction != null ? 'fraction' : 'none',
      isUpperBound: overheadFraction == null,
      contextWindow,
      fits,
      projection
    }
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    // Issue #634: this handler's preflight previously omitted
    // Access-Control-Allow-Headers entirely, so browser preflights carrying
    // Content-Type were rejected even though POST + JSON body is supported.
    // Same baseline allowlist as the shared api/_cors.js helper.
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Request-Id');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  const params = req.method === 'POST' ? (req.body || {}) : req.query;

  try {
    const { status, body } = await estimate(params);
    return json(res, body, status);
  } catch (err) {
    // RFC 9457 problem+json (#539): ApiErrors keep their stable code/status;
    // legacy tagged errors carry err.status from the resolution tiers
    // (502 HF unreachable, 403 gated/private, 422 bad header, 400/404
    // caller-wrong id) and map to their stable codes here.
    if (err instanceof ApiError) return sendProblemFromError(res, req, err);
    const status = Number.isInteger(err.status) ? err.status : 500;
    const code = status === 502 ? 'UPSTREAM_UNAVAILABLE'
      : status >= 500 ? 'INTERNAL'
      : status === 404 ? 'NOT_FOUND'
      : 'INVALID_PARAMS';
    return sendProblem(res, req, { status, code, detail: String(err.message || err) });
  }
}
