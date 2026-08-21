// GET/POST /api/vram — combined model + KV-cache + context VRAM estimate from
// a bare { hfId, context, quant }. Architecture (layers, hidden dim, GQA
// heads, head dim) and weight size are resolved from the Hugging Face config
// automatically, so agents never guess model internals.
//
//   /api/vram?hfId=meta-llama/Llama-3.1-8B-Instruct&context=65536&quant=q4_k_m
//   /api/vram?hfId=...&context=...&vramGb=24            → fits + max context
//   /api/vram?hfId=...&numTurns=40&tokensPerTurn=1200   → per-turn KV growth
//                                                          with overflow turns

import { resolveModel } from './_hfconfig.js';
import { resolveQuant } from './_quant.js';

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

async function estimate(params) {
  const hfId = params.hfId ?? params.model ?? params.repo;
  if (!hfId) {
    return {
      status: 400,
      body: {
        error: 'missing hfId — pass ?hfId=org/model (e.g. meta-llama/Llama-3.1-8B-Instruct)',
        params: ['hfId (required)', 'context (tokens, default 32768)', 'quant (default q4_k_m)',
          'batchSize (default 1)', 'kvPrecisionBytes (default 2 = FP16)', 'vramGb (optional budget)',
          'numTurns + tokensPerTurn (optional per-turn KV projection)'],
        examples: [
          '/api/vram?hfId=meta-llama/Llama-3.1-8B-Instruct&context=65536&quant=q4_k_m',
          '/api/vram?hfId=Qwen/Qwen2.5-32B&context=131072&quant=q4_k_m&vramGb=24'
        ]
      }
    };
  }

  const resolved = await resolveModel(hfId, { quant: params.quant ?? params.q }); // throws tagged httpErrors
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
      perTurnKvGb: round((bytesPerToken * tokensPerTurn * batchSize) / GB),
      turns,
      firstContextOverflowTurn,
      firstVramOverflowTurn
    };
  }

  return {
    status: 200,
    body: {
      inputs: {
        hfId: resolved.hfId, context, quant: params.quant ?? 'q4_k_m',
        resolvedQuant: quant.key, quantAssumed: quant.assumed,
        batchSize, kvPrecisionBytes, ...(vramGb != null ? { vramGb } : {})
      },
      model: {
        hfId: resolved.hfId,
        family: resolved.family,
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

  const params = req.method === 'POST' ? (req.body || {}) : req.query;

  try {
    const { status, body } = await estimate(params);
    return json(res, body, status);
  } catch (err) {
    const status = Number.isInteger(err.status) ? err.status : 500;
    return json(res, { error: String(err.message || err) }, status);
  }
}
