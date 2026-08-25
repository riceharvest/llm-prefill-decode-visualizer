// Resolve a Hugging Face model id into the architecture numbers the KV-cache
// and weight math need (layers, hidden dim, attention/KV heads, head dim,
// param count). Two paths:
//   1. config.json from the repo root (standard safetensors repos)
//   2. parse the largest .gguf file's header metadata (GGUF-only repos ship
//      no config.json)
//
// Cached in memory for 10 minutes so batched agent loops don't hammer HF.

import { normalizeModelId } from './_normalize.js';
import { readGgufMetadata, architectureFromGguf } from './_gguf.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // hfId -> { data, at }

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// HF repo ids are "org/model" — letters/digits plus ".", "_" or "-" per
// segment. Anything else (spaces, "?", "#", "%", "/") would flow raw into
// the outbound huggingface.co URLs below and could inject query strings,
// fragments or extra path segments into a server-side request (#691), so
// reject it before any fetch is built.
const HF_ID_RE = /^[\w.-]+\/[\w.-]+$/;

/** "org/model" → "org%2Fmodel"-style per-segment encoding for URL paths. */
const encodeHfIdPath = id => id.split('/').map(encodeURIComponent).join('/');

/** Merge top-level fields into a nested text_config (multimodal repos). */
function textConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return {};
  return cfg.text_config && typeof cfg.text_config === 'object'
    ? { ...cfg.text_config, ...pickTopLevel(cfg) }
    : cfg;
}

// Fields that live on the top-level config even for multimodal models.
function pickTopLevel(cfg) {
  const keys = ['num_hidden_layers', 'hidden_size', 'num_attention_heads',
    'num_key_value_heads', 'head_dim', 'max_position_embeddings'];
  const out = {};
  for (const k of keys) if (cfg[k] !== undefined) out[k] = cfg[k];
  return out;
}

async function fetchJson(url, whatFor) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'follow' });
  } catch (err) {
    throw httpError(502, `could not reach huggingface.co for ${whatFor}: ${err.message}`);
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) return null;
  if (!res.ok) {
    throw httpError(502, `huggingface.co returned ${res.status} for ${whatFor}`);
  }
  try {
    return await res.json();
  } catch {
    throw httpError(502, `invalid JSON from huggingface.co for ${whatFor}`);
  }
}

/** Largest main-model .gguf sibling (mmproj projector files excluded). */
function biggestGguf(info, quant) {
  const siblings = Array.isArray(info?.siblings) ? info.siblings : [];
  const files = siblings
    .filter(s => typeof s?.rfilename === 'string'
      && s.rfilename.toLowerCase().endsWith('.gguf')
      && !s.rfilename.toLowerCase().includes('mmproj'))
    .map(s => ({ name: s.rfilename, size: s.size }))
    .filter(s => Number.isFinite(s.size) && s.size > 0);
  if (!files.length) return null;

  // Combine sharded parts ("-00001-of-00002") so multi-part models report
  // their true total instead of one shard.
  const groups = new Map();
  for (const f of files) {
    const key = f.name.replace(/-\d+-of-\d+(?=\.gguf$)/i, '');
    if (!groups.has(key)) groups.set(key, { name: f.name, bytes: 0, parts: 0 });
    const g = groups.get(key);
    g.bytes += f.size;
    g.parts += 1;
    // keep the first shard's filename as the human-readable representative
    if (f.name < g.name) g.name = f.name;
  }
  let candidates = [...groups.values()].map(g => ({
    name: g.name,
    bytes: g.bytes,
    source: `file size of ${g.name}${g.parts > 1 ? ` (${g.parts}-part GGUF)` : ''} (GGUF repo already quantized)`
  }));

  // When the caller asked for a specific quant, prefer a file whose name
  // carries it (unsloth-style repos ship every quant side by side). Try
  // variants in priority order: exact tag first, then the loose family.
  const variants = quantVariants(quant);
  if (variants.size) {
    for (const v of variants) {
      const matched = candidates.filter(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(v));
      if (matched.length) {
        candidates = matched;
        break;
      }
    }
  }

  return candidates.sort((a, b) => b.bytes - a.bytes)[0];
}

// 'Q4_K_M' → {q4km, q4k}; 'FP16' → {fp16, f16, bf16}; …
function quantVariants(quant) {
  const qn = String(quant || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!qn) return new Set();
  const out = new Set([qn]);
  if (/^q\d/.test(qn) && qn.length > 3 && qn[2] === 'k') out.add(qn.slice(0, 3));
  const half = { fp16: 1, f16: 1, bf16: 1 };
  if (half[qn]) ['fp16', 'f16', 'bf16'].forEach(v => out.add(v));
  if (qn === 'fp8' || qn === 'f8') { out.add('fp8'); out.add('f8'); }
  return out;
}

/**
 * Resolve architecture + weight size for an hfId. Throws tagged httpErrors
 * with friendly messages for expected failure modes.
 */
export async function resolveModel(hfIdRaw, { quant } = {}) {
  const hfId = String(hfIdRaw || '').trim().replace(/^https?:\/\/huggingface\.co\//, '').replace(/\/+$/, '');
  if (!hfId || !hfId.includes('/')) {
    throw httpError(400, 'hfId must look like "org/model" or a full huggingface.co URL');
  }
  if (!HF_ID_RE.test(hfId)) {
    throw httpError(400, `invalid hfId "${hfId}" — use "org/model" (letters, digits, ".", "_", "-" only) or a full huggingface.co URL`);
  }

  // GGUF weight-size selection depends on the requested quant, so keep
  // separate cache slots per quant tag.
  const cacheKey = `${hfId.toLowerCase()}::${String(quant || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const data = await resolveUncached(hfId, quant);
  cache.set(cacheKey, { data, at: Date.now() });
  return data;
}

async function resolveUncached(hfId, quant) {
  const notes = [];
  const [cfg, info] = await Promise.all([
    fetchJson(`https://huggingface.co/${encodeHfIdPath(hfId)}/resolve/main/config.json`, `${hfId}/config.json`),
    fetchJson(
      `https://huggingface.co/api/models/${hfId.split('/').map(encodeURIComponent).join('/')}?blobs=true`,
      `${hfId} model metadata`
    )
  ]);

  if (cfg == null && info == null) {
    throw httpError(404, `Hugging Face has no readable repo "${hfId}" — check the hfId (e.g. "meta-llama/Llama-3.1-8B-Instruct"); gated repos must be public`);
  }

  // ---- Path 1: config.json ----
  if (cfg != null) {
    const t = textConfig(cfg);
    const numLayers = t.num_hidden_layers;
    const hiddenSize = t.hidden_size;
    const numHeads = t.num_attention_heads ?? t.num_heads;
    if (![numLayers, hiddenSize, numHeads].every(Number.isFinite)) {
      notes.push('config.json lacks num_hidden_layers / hidden_size / num_attention_heads');
    } else {
      return assemble({ hfId, notes, info,
        arch: {
          numLayers,
          hiddenSize,
          numHeads,
          kvHeads: Number.isFinite(t.num_key_value_heads) ? t.num_key_value_heads : numHeads,
          headDim: Number.isFinite(t.head_dim) ? t.head_dim : hiddenSize / numHeads,
          maxContextLength: Number.isFinite(t.max_position_embeddings) ? t.max_position_embeddings : null
        },
        paramsTotal: Number.isFinite(info?.safetensors?.total) && info.safetensors.total > 0
          ? info.safetensors.total
          : null,
        weightsSource: Number.isFinite(info?.safetensors?.total) && info.safetensors.total > 0
          ? 'safetensors parameter count from HF metadata'
          : null,
        weightsSourceKind: 'params×quant',
        source: 'huggingface.co/config.json + api/models metadata'
      });
    }
    notes.push('falling back to GGUF header parsing');
  }

  // ---- Path 2: GGUF file header ----
  const gguf = biggestGguf(info, quant);
  if (!gguf) {
    throw httpError(403,
      `"${hfId}" is gated/private or has no config.json and no .gguf files — architecture cannot be resolved automatically. Try an ungated mirror of the same model.`);
  }

  const url = `https://huggingface.co/${encodeHfIdPath(hfId)}/resolve/main/${gguf.name.split('/').map(encodeURIComponent).join('/')}`;
  const meta = await readGgufMetadata(url);
  const arch = architectureFromGguf(meta);
  if (!arch) {
    throw httpError(422, `could not read architecture fields from the GGUF header of ${gguf.name} in "${hfId}"`);
  }

  return assemble({
    hfId, notes, info,
    arch: { ...arch, maxContextLength: meta[`${archKey(meta)}.context_length`] ?? null },
    paramsTotal: null,
    weightsFileBytes: gguf.bytes,
    weightsSource: gguf.source,
    weightsSourceKind: 'file-size',
    source: `GGUF header of ${gguf.name}`,
    quant
  });
}

function archKey(meta) {
  return meta['general.architecture'] || '';
}

function assemble({ hfId, notes, info, arch, paramsTotal, weightsFileBytes, weightsSource, weightsSourceKind, source, quant }) {
  if (weightsFileBytes == null) {
    const gguf = biggestGguf(info, quant);
    if (gguf) {
      weightsFileBytes = gguf.bytes;
      if (!weightsSource) weightsSource = gguf.source;
      weightsSourceKind ??= 'file-size';
    }
  }
  return {
    hfId,
    family: normalizeModelId(hfId),
    architecture: {
      ...arch,
      gqaRatio: arch.kvHeads > 0 ? arch.numHeads / arch.kvHeads : null
    },
    paramsTotal,
    weightsFileBytes: weightsFileBytes ?? null,
    weightsSource: paramsTotal != null ? weightsSource : (weightsSource || null),
    weightsSourceKind: paramsTotal != null ? weightsSourceKind : (weightsSourceKind || null),
    source,
    notes
  };
}
