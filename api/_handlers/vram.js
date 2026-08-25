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
import { enforceRateLimit } from '../_ratelimit.js';
import { problemBody } from '../_errors.js';

export const config = { runtime: 'nodejs' };

const GB = 1024 ** 3;

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // #516: only successful estimates are CDN-cacheable. Error bodies depend on
  // the caller's query string and must never be stored by shared caches —
  // sibling endpoints already send no-store on their error paths.
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=600' : 'no-store');
  res.end(JSON.stringify(body, null, 2));
}

/**
 * RFC 9457 problem+json error shape (#514): every /api/vram validation and
 * upstream failure carries type/title/status/code so agents can branch on the
 * stable code. Legacy flat members (`error`, `params`, `examples`) are kept
 * alongside as back-compat extras so existing clients keep working.
 */
function problem(res, req, status, code, detail, extras = {}) {
  const body = {
    ...problemBody({ status, code, detail, instance: (req?.url || '').split('?')[0] }),
    error: detail,
    ...extras
  };
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/problem+json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body, null, 2));
}

/** Map an upstream failure status to a stable ERROR_CODES registry entry. */
function errorCodeForStatus(status) {
  if (status === 404) return 'NOT_FOUND';
  if (status === 502 || status === 503 || status === 504) return 'UPSTREAM_UNAVAILABLE';
  if (status === 400) return 'INVALID_PARAMS';
  return 'INTERNAL';
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
    return {
      status: 400,
      problem: true,
      detail: "missing hfId — pass ?hfId=org/model (e.g. meta-llama/Llama-3.1-8B-Instruct)",
      extras: {
        params: ['hfId (required)', 'context (tokens, default 32768)', 'quant (default q4_k_m)',
          'batchSize (default 1)', 'kvPrecisionBytes (default 2 = FP16)', 'vramGb (optional budget, GiB)',
          'numTurns + tokensPerTurn (optional per-turn KV projection)'],
        units: 'all memory figures are GiB (binary, 1024-based), not decimal GB',
        examples: [
          '/api/vram?hfId=meta-llama/Llama-3.1-8B-Instruct&context=65536&quant=q4_k_m',
          '/api/vram?hfId=Qwen/Qwen2.5-32B&context=131072&quant=q4_k_m&vramGb=24'
        ]
      }
    };
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
  const context = Math.max(1, Math.round(num(params.context ?? params.contextLength, 32768)));
  const batchSize = Math.max(1, Math.round(num(params.batchSize, 1)));
  const kvPrecisionBytes = num(params.kvPrecisionBytes, 2);

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
  const totalGb = weightsGb != null ? round(weightsGb + kvGb) : null;

  // Context-window check against the model's own max_position_embeddings.
  const maxCtx = arch.maxContextLength;
  const contextWindow = {
    maxPositionEmbeddings: maxCtx,
    requested: context,
    withinLimit: maxCtx == null ? null : context <= maxCtx,
    overflowTokens: maxCtx != null ? Math.max(0, context - maxCtx) : null
  };

  // Optional VRAM budget → does it fit, and what context would fit instead?
  const vramGb = num(params.vramGb, null);
  let fits = null;
  if (vramGb != null && totalGb != null) {
    const budgetBytes = vramGb * GB;
    const bytesPerCtxToken = bytesPerToken * batchSize;
    fits = {
      vramGb,
      fits: totalGb <= vramGb,
      headroomGb: round((budgetBytes - weightsGb * GB - kvBytesTotal) / GB),
      maxContextTokens: bytesPerCtxToken > 0
        ? Math.max(0, Math.floor((budgetBytes - weightsGb * GB) / bytesPerCtxToken))
        : null,
      note: 'maxContextTokens ignores activation/overhead — treat as an upper bound'
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
        batchSize, kvPrecisionBytes, ...(vramGb != null ? { vramGb } : {})
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
          ? { weightsGb, kvCacheGb: kvGb }
          : { weightsGb: null, kvCacheGb: kvGb, note: 'weight size unresolvable for this repo' }
      },
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
    return res.status(204).end();
  }

  // Self-throttling signal on every response incl. validation failures (#515).
  if (!enforceRateLimit(req, res)) return;

  const params = req.method === 'POST' ? (req.body || {}) : req.query;

  try {
    const { status, problem: isProblem, detail, extras, body } = await estimate(params);
    if (isProblem) return problem(res, req, status, 'INVALID_PARAMS', detail, extras);
    return json(res, body, status);
  } catch (err) {
    const status = Number.isInteger(err.status) ? err.status : 500;
    const detail = String(err.message || err);
    return problem(res, req, status, errorCodeForStatus(status), detail);
  }
}
