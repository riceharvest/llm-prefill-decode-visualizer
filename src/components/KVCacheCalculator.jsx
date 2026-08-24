import React, { useState, useEffect } from 'react';
import { HardDrive, Cpu, Gauge } from 'lucide-react';
import { formatTokens } from '../utils/presets';
import { readParam, readParamNum, writeParams } from '../utils/urlState';
import { DEFAULT_OVERHEAD_FRACTION, vramBudget } from '../../api/_math.js';
import { GPU_CATALOG, WEIGHT_PRECISIONS, gpuById, parseParamsB, weightsGiB } from '../utils/vramPlanner';
import Metric from './Metric';
import Analogy from './Analogy';
import { memoryLedger, SAFETY_HEADROOM_FRACTION } from '../../api/_math.js';
import { resolveBudgetVramGb, gpuSelectionPatch } from '../utils/kvGpuState';
import MultiGpuPlanner from './MultiGpuPlanner';
import ChartDataTable from './ChartDataTable';
import { t } from '../i18n/strings';

// KV-cache geometry pulled from each model's actual config.json on HuggingFace
// and its architecture paper. Four KV modes:
//   'gqa'  -> bytes/token/layer = 2 * kvHeads * headDim * bytes (standard GQA/MHA)
//   'mla'  -> bytes/token/layer = (kvLoraRank + qkRopeHeadDim) * bytes
//            (Multi-head Latent Attention: only the compressed latent + RoPE
//             part is cached per token; kvLayers counts the layers that store KV)
//   'sliding' -> hybrid: full-attention layers cache every token; sliding-window
//            layers cache only the most recent `window` tokens (bounded, not
//            proportional to context)
//   'csa_hca' -> DeepSeek-V4 compressed sparse attention: KV compressed along the
//            sequence dimension (CSA rate m, HCA rate m'). We anchor on the
//            paper's own measured figure (arXiv 2606.19348, Fig. 1): at 1M
//            context V4-Flash KV = V3.2's 48.8 GB / 13.7 ≈ 3.6 GB at their
//            mixed BF16/FP8 storage. Base is FP8 (~1 B/elem).
const MODEL_PRESETS = [
  {
    id: 'llama70b',
    name: 'LLaMA-3.3 70B',
    params: '70B',
    layers: 80,
    kvHeads: 8,
    headDim: 128,
    kvMode: 'gqa',
    kvLayers: 80,
    maxContext: 131072,
    desc: 'GQA · 8 KV heads × 128',
    source: 'config.json'
  },
  {
    id: 'llama8b',
    name: 'LLaMA-3.1 8B',
    params: '8B',
    layers: 32,
    kvHeads: 8,
    headDim: 128,
    kvMode: 'gqa',
    kvLayers: 32,
    maxContext: 131072,
    desc: 'GQA · 8 KV heads × 128',
    source: 'config.json'
  },
  {
    id: 'mistral7b',
    name: 'Mistral 7B',
    params: '7B',
    layers: 32,
    kvHeads: 8,
    headDim: 128,
    kvMode: 'gqa',
    kvLayers: 32,
    maxContext: 131072,
    desc: 'GQA · 8 KV heads × 128',
    source: 'config.json'
  },
  {
    id: 'qwen3627b',
    name: 'Qwen3.6-27B',
    params: '27B',
    layers: 64,
    kvHeads: 4,
    headDim: 256,
    kvMode: 'gqa',
    kvLayers: 16, // only 16 full-attention layers cache KV (48 linear layers are recurrent)
    maxContext: 262144,
    desc: 'Hybrid · 16 full-attn + 48 linear × 4 KV heads × 256',
    source: 'config.json'
  },
  {
    id: 'qwen3635ba3b',
    name: 'Qwen3.6-35B-A3B',
    params: '36B',
    layers: 40,
    kvHeads: 2,
    headDim: 256,
    kvMode: 'gqa',
    kvLayers: 10, // only 10 full-attention layers cache KV (30 linear layers are recurrent)
    maxContext: 262144,
    desc: 'Hybrid MoE · 10 full-attn + 30 linear × 2 KV heads × 256',
    source: 'config.json'
  },
  {
    id: 'dsv4flash',
    name: 'DeepSeek-V4-Flash-0731',
    params: '284B',
    layers: 43,
    kvMode: 'csa_hca',
    m: 4,        // CSA compression rate (paper §4.2.1)
    mPrime: 128, // HCA compression rate
    swaLayers: 2,      // first 2 layers are pure sliding-window attention
    swaWindow: 128,
    csaHcaLayers: 41,  // remaining layers interleave CSA (m=4) and HCA (m'=128)
    kvBytesAt1M: 3.56e9, // paper Fig. 1: 48.8 GB (V3.2) / 13.7 ≈ 3.6 GB @ 1M
    maxContext: 1048576,
    desc: 'CSA/HCA compressed · ~3.6 GB KV @ 1M (paper)',
    source: 'arXiv 2606.19348 Fig.1'
  },
  {
    id: 'museglimmer',
    name: 'Muse-Glimmer-30B',
    params: '28B',
    layers: 52,
    kvHeads: 2,
    headDim: 128,
    kvMode: 'sliding',
    fullAttnLayers: 13,
    slidingLayers: 39,
    slidingWindow: 2048,
    kvLayers: 52,
    maxContext: 131072,
    desc: 'GQA · 13 full + 39 sliding (win 2048) × 2 heads × 128',
    source: 'config.json'
  },
  {
    id: 'kimik3',
    name: 'Kimi-K3',
    params: '2.8T',
    layers: 93,
    kvMode: 'mla',
    kvLoraRank: 512,
    qkRopeHeadDim: 64,
    kvLayers: 24, // only full-attention layers cache KV (KDA linear layers don't)
    maxContext: 1048576,
    desc: 'KDA · MLA · 24 full-attn layers cache KV',
    source: 'config.json'
  },
  {
    id: 'lfm25',
    name: 'LFM2.5-2.6B',
    params: '2.6B',
    layers: 30,
    kvHeads: 8,
    headDim: 64,
    kvMode: 'gqa',
    kvLayers: 30,
    maxContext: 131072,
    desc: 'GQA · 8 KV heads × 64',
    source: 'config.json'
  },
  {
    id: 'glm52',
    name: 'GLM-5.2',
    params: '754B',
    layers: 78,
    kvMode: 'mla',
    kvLoraRank: 512,
    qkRopeHeadDim: 64,
    kvLayers: 78,
    maxContext: 1048576,
    desc: 'DSA · MLA · 78 layers × (512+64)',
    source: 'config.json'
  }
];

// FP16/BF16 (2B), FP8/INT8 (1B), INT4 (0.5B). DeepSeek's paper figure is at
// mixed BF16/FP8 storage ≈ 1 B/elem, so csa_hca scales from the FP8 base.
function kvBytesPerToken(preset, precisionBytes, contextLength) {
  switch (preset.kvMode) {
    case 'gqa':
      return 2 * preset.kvLayers * preset.kvHeads * preset.headDim * precisionBytes;

    case 'mla':
      return preset.kvLayers * (preset.kvLoraRank + preset.qkRopeHeadDim) * precisionBytes;

    case 'sliding': {
      // full-attn layers cache `contextLength` tokens; sliding layers cache
      // only the last `window` tokens regardless of context
      const safeCtx = Math.max(1, contextLength); // guard 0/negative typed ctx (0/0 = NaN)
      const perLayerBytes = 2 * preset.kvHeads * preset.headDim * precisionBytes;
      const fullBytes = preset.fullAttnLayers * perLayerBytes * safeCtx;
      const windowTokens = Math.min(safeCtx, preset.slidingWindow);
      const slidingBytes = preset.slidingLayers * perLayerBytes * windowTokens;
      return (fullBytes + slidingBytes) / safeCtx; // effective per-token
    }

    case 'csa_hca': {
      // kvBytesAt1M is the TOTAL KV bytes at 1M context (paper Fig. 1, ~1 B/elem
      // mixed BF16/FP8). Average per-token bytes = total / context — CONSTANT,
      // so total KV scales linearly with context (fixes quadratic scaling bug).
      // The real curve is slightly sublinear per-token at short contexts due to
      // SWA + compression granularity, but the paper gives no closed form; the
      // constant-average model is correct at the anchor point and conservative
      // (slightly over-estimates) below it.
      return (preset.kvBytesAt1M / 1048576) * precisionBytes;
    }

    default:
      return 0;
  }
}

// Parameter count in billions, parsed from the preset's display string
// ('70B' → 70, '2.8T' → 2800). Used for the weights line of the ledger.
function presetParamsB(preset) {
  const m = String(preset.params).match(/^([\d.]+)\s*([BT]?)$/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2].toUpperCase() === 'T' ? n * 1000 : n;
}

// Target GPUs for the budget ledger. VRAM figures are the physical card /
// unified-memory totals users actually shop against.
const GPU_PRESETS = [
  { id: 'rtx3060', name: 'RTX 3060', vramGb: 12 },
  { id: 'rtx4090', name: 'RTX 4090', vramGb: 24 },
  { id: 'dual3090', name: 'Dual RTX 3090', vramGb: 48 },
  { id: 'a10080', name: 'A100 80GB', vramGb: 80 },
  { id: 'h200', name: 'H200 141GB', vramGb: 141 },
  { id: 'm3ultra', name: 'Mac Studio M3 Ultra', vramGb: 192, unified: true }
];

function kvFormula(preset) {
  switch (preset.kvMode) {
    case 'gqa':
      return `2 × ${preset.kvLayers} layers × ${preset.kvHeads} KV heads × ${preset.headDim} dim × bytes`;
    case 'mla':
      return `${preset.kvLayers} layers × (${preset.kvLoraRank} latent + ${preset.qkRopeHeadDim} rope) × bytes`;
    case 'sliding':
      return `${preset.fullAttnLayers} full layers × ctx + ${preset.slidingLayers} sliding × min(ctx, ${preset.slidingWindow})`;
    case 'csa_hca':
      return `paper: 48.8 GB (V3.2) ÷ 13.7 ≈ 3.6 GB @ 1M, CSA m=${preset.m} / HCA m=${preset.mPrime}`;
    default:
      return '';
  }
}

export default function KVCacheCalculator() {
  const [modelPreset, setModelPreset] = useState(() => readParam('model') || 'llama70b');
  const [contextLength, setContextLength] = useState(() => readParamNum('ctx', 32768));
  const [precision, setPrecision] = useState(() => {
    const p = readParamNum('prec', 2);
    return [2, 1, 0.5].includes(p) ? p : 2; // 2 bytes = FP16/BF16, 1 = FP8/INT8, 0.5 = INT4
  });
  const [batchSize, setBatchSize] = useState(() => readParamNum('batch', 1));
  // Target GPU for the memory ledger: preset id + its VRAM (editable for
  // cards that aren't in the list — editing clears the preset id).
  const [gpuVramGb, setGpuVramGb] = useState(() => {
    const fromUrl = readParamNum('vram', NaN);
    if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
    const preset = GPU_PRESETS.find(g => g.id === (readParam('gpu') || 'rtx4090'));
    return preset ? preset.vramGb : 24;
  });

  // VRAM budget planner state (issue #45)
  const [weightPrecisionId, setWeightPrecisionId] = useState(() => {
    const id = readParam('wp');
    return WEIGHT_PRECISIONS.some(p => p.id === id) ? id : 'fp16';
  });
  const [gpuId, setGpuId] = useState(() => {
    const g = readParam('gpu');
    return gpuById(g) ? g : 'rtx4090';
  });
  const [overheadPct, setOverheadPct] = useState(() =>
    Math.min(40, Math.max(0, readParamNum('oh', DEFAULT_OVERHEAD_FRACTION * 100)))
  );
  // Measured weights size (GB) — overrides the parameter-count estimate
  const [weightsOverrideGb, setWeightsOverrideGb] = useState(() => Math.max(0, readParamNum('wgb', 0)));

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({ model: modelPreset, ctx: contextLength, prec: precision, batch: batchSize,
      wp: weightPrecisionId, gpu: gpuId, oh: overheadPct, wgb: weightsOverrideGb || undefined, vram: gpuVramGb });
  }, [modelPreset, contextLength, precision, batchSize, weightPrecisionId, gpuId, overheadPct, weightsOverrideGb, gpuVramGb]);

  const preset = MODEL_PRESETS.find(p => p.id === modelPreset) || MODEL_PRESETS[0];

  // Sanitize typed inputs for math (number fields allow 0/negative values)
  const safeContext = Math.max(0, contextLength || 0);
  const safeBatch = Math.max(0, batchSize || 0);

  // KV Cache size per token in bytes (per sequence)
  const bytesPerTokenSingleSeq = kvBytesPerToken(preset, precision, safeContext);
  const totalKVCacheBytes = bytesPerTokenSingleSeq * safeContext * safeBatch;
  const totalKVCacheGB = totalKVCacheBytes / (1024 * 1024 * 1024);
  const totalKVCacheMB = totalKVCacheBytes / (1024 * 1024);

  // ---- Memory ledger: weights + KV + overhead vs selected GPU ----
  const weightPreset = WEIGHT_PRECISIONS.find(p => p.id === weightPrecisionId) || WEIGHT_PRECISIONS[0];
  const paramsB = parseParamsB(preset.params);
  const estimatedWeightsGiB = paramsB !== null ? weightsGiB(paramsB, weightPreset.bpw) : null;
  const usesMeasuredWeights = weightsOverrideGb > 0;
  const weightsGb = usesMeasuredWeights ? weightsOverrideGb : (estimatedWeightsGiB || 0);

  const overheadFraction = overheadPct / 100;
  const selectedGpu = gpuById(gpuId);
  // #988: one VRAM source of truth for BOTH panels — the planner honors the
  // same explicit-ledger override the ledger does, instead of silently using
  // the gpu preset capacity and rendering contradictory fits.
  const budgetVramGb = resolveBudgetVramGb(selectedGpu, gpuVramGb);
  const applyGpuPatch = patch => {
    if ('gpuVramGb' in patch) setGpuVramGb(patch.gpuVramGb);
    setGpuId(patch.gpuId);
  };
  const budget = vramBudget({
    weightsGb,
    kvGb: totalKVCacheGB,
    overheadFraction,
    gpuVramGb: budgetVramGb
  });
  const gpuVerdicts = GPU_CATALOG.map(gpu => ({
    gpu,
    verdict: vramBudget({ weightsGb, kvGb: totalKVCacheGB, overheadFraction, gpuVramGb: gpu.vramGb }).verdict
  }));

  const fmtGb = gb => gb >= 100 ? gb.toFixed(0) : gb.toFixed(1);

  // Full memory ledger: weights + KV + framework overhead vs the target GPU
  const safeGpuVram = Math.max(0, gpuVramGb || 0);
  const ledger = memoryLedger({
    paramsB: presetParamsB(preset),
    precisionBytes: precision,
    kvBytes: totalKVCacheBytes,
    gpuVramGb: safeGpuVram
  });
  const VERDICT_STYLE = {
    pass: { color: 'var(--decode)', dim: 'var(--decode-dim)', border: 'var(--decode-border)' },
    warn: { color: 'var(--warn)', dim: 'rgba(245, 158, 11, 0.10)', border: 'rgba(245, 158, 11, 0.35)' },
    fail: { color: 'var(--danger)', dim: 'rgba(248, 113, 113, 0.10)', border: 'rgba(248, 113, 113, 0.35)' }
  };
  const verdictLabel = {
    pass: t('kvCache.verdictPass'),
    warn: t('kvCache.verdictWarn'),
    fail: t('kvCache.verdictFail')
  };
  const verdictDetail = {
    pass: t('kvCache.verdictPassDetail'),
    warn: t('kvCache.verdictWarnDetail'),
    fail: t('kvCache.verdictFailDetail')
  };
  // Stacked bar scale: the larger of usage and VRAM, so both always fit on screen
  const barScaleGb = Math.max(ledger.totalGb || 0, safeGpuVram, 1);
  const segPct = gb => `${Math.min(100, (gb / barScaleGb) * 100)}%`;

  return (
    <div className="stack">

      <section className="panel" aria-label={t('kvCache.panelAria')}>
        <h2 className="panel-title" style={{ marginBottom: '12px' }} tabIndex={-1} data-panel-heading>
          <HardDrive size={16} />
          <span>{t('kvCache.panelTitle')}</span>
          <Analogy term="kvCache" />
        </h2>

        <p className="hint-text" style={{ marginBottom: '18px', maxWidth: '900px' }}>
          {t('kvCache.intro')}
        </p>

        {/* Model Presets */}
        <div className="seg" style={{ flexWrap: 'wrap', marginBottom: '18px', gap: '2px' }}>
          {MODEL_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => setModelPreset(p.id)}
              data-tooltip={`${p.desc} · source: ${p.source}`}
              className={modelPreset === p.id ? 'active' : ''}
              aria-pressed={modelPreset === p.id}
              style={{ fontFamily: 'var(--font-sans)', fontSize: '0.76rem' }}
            >
              {p.name} <span style={{ opacity: 0.65, fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>{p.params}</span>
            </button>
          ))}
        </div>

        {/* Parameter Sliders */}
        <div className="grid-auto" style={{ '--grid-min': '15rem', marginBottom: '18px' }}>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('kvCache.contextLength')}</span>
              <span className="field-value" style={{ color: 'var(--accent)' }}>{formatTokens(contextLength)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="1024"
                max={Math.min(1048576, preset.maxContext)}
                step="1024"
                value={Math.min(contextLength, preset.maxContext)}
                aria-label={t('kvCache.contextAria')}
                aria-valuetext={`${Math.min(contextLength, preset.maxContext).toLocaleString()} tokens context`}
                onChange={(e) => setContextLength(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={contextLength}
                aria-label={t('kvCache.contextValueAria')}
                onChange={(e) => setContextLength(Number(e.target.value))}
                style={{ width: '5.625rem' }}
              />
            </div>
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('kvCache.concurrentBatchSize')}</span>
              <span className="field-value" style={{ color: 'var(--prefill)' }}>{batchSize} {t('kvCache.seqUnit')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="1"
                max="64"
                step="1"
                value={batchSize}
                aria-label={t('kvCache.batchAria')}
                aria-valuetext={`batch of ${batchSize} ${batchSize === 1 ? 'sequence' : 'sequences'}`}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={batchSize}
                aria-label={t('kvCache.batchValueAria')}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                style={{ width: '4rem' }}
              />
            </div>
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('kvCache.precisionLabel')}</span>
              <span className="field-value" style={{ color: 'var(--decode)' }}>
                {precision === 2 ? 'FP16/BF16' : precision === 1 ? 'FP8/INT8' : 'INT4'}
              </span>
            </div>
            <div className="seg" role="group" aria-label={t('kvCache.precisionGroupAria')} style={{ marginTop: '2px' }}>
              {[
                { val: 2, label: t('kvCache.precisionFp16') },
                { val: 1, label: t('kvCache.precisionFp8') },
                { val: 0.5, label: t('kvCache.precisionInt4') }
              ].map(opt => (
                <button
                  key={opt.val}
                  onClick={() => setPrecision(opt.val)}
                  className={precision === opt.val ? 'active' : ''}
                  aria-pressed={precision === opt.val}
                  style={{ flex: 1 }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Results */}
        <div className="metric-grid">
          <div className="metric" style={{ borderInlineStartColor: 'var(--accent)' }}>
            <div className="metric-label">{t('kvCache.metricKvPerToken')}</div>
            <div className="metric-value" style={{ color: 'var(--accent)' }}>
              <Metric
                term="kvPerToken"
                substitution={`${kvFormula(preset)} × ${precision} bytes = ${(bytesPerTokenSingleSeq / 1024).toFixed(1)} KB`}
              >
                {(bytesPerTokenSingleSeq / 1024).toFixed(1)} KB
              </Metric>
            </div>
          </div>

          <div className="metric" style={{ borderInlineStartColor: 'var(--prefill)' }}>
            <div className="metric-label">{t('kvCache.metricTotalVram')}</div>
            <div className="metric-value" style={{ color: 'var(--prefill)', fontSize: '1.55rem' }}>
              <Metric
                term="kvTotal"
                substitution={`${(bytesPerTokenSingleSeq / 1024).toFixed(1)} KB × ${safeContext.toLocaleString()} tok × ${safeBatch} batch = ${totalKVCacheGB >= 1 ? `${totalKVCacheGB.toFixed(2)} GB` : `${totalKVCacheMB.toFixed(0)} MB`}`}
                align="left"
              >
                {totalKVCacheGB >= 1 ? `${totalKVCacheGB.toFixed(2)} GB` : `${totalKVCacheMB.toFixed(0)} MB`}
              </Metric>
            </div>
          </div>

          <div className="metric" style={{ borderInlineStartColor: 'var(--decode)' }}>
            <div className="metric-label">
              {t('kvCache.formulaLabel', {
                mode: preset.kvMode === 'mla' ? t('kvCache.modeMla')
                  : preset.kvMode === 'sliding' ? t('kvCache.modeGqaSwa')
                  : preset.kvMode === 'csa_hca' ? t('kvCache.modeCsaHca')
                  : t('kvCache.modeGqa')
              })}
            </div>
            <div style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--decode)', marginTop: '8px', lineHeight: 1.5 }}>
              {kvFormula(preset)}
            </div>
          </div>
        </div>

        {/* ---- Full memory budget ledger ---- */}
        <section className="panel-inset" aria-label={t('kvCache.ledgerAria')} style={{ marginTop: '18px', padding: '14px 16px' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Cpu size={14} />
            <span>{t('kvCache.ledgerTitle')}</span>
          </h3>
          <p className="hint-text" style={{ marginBottom: '12px' }}>
            {t('kvCache.ledgerIntro')}
          </p>

          {/* Per-GPU verdict chips double as the GPU selector */}
          <div className="field-head" style={{ marginBottom: '6px' }}>
            <span className="field-label">{t('kvCache.gpuBudgetLabel')} · {t('kvCache.perGpuVerdicts')}</span>
          </div>
          <div className="seg" role="group" aria-label={t('kvCache.gpuBudgetAria')} style={{ flexWrap: 'wrap', gap: '2px', marginBottom: '10px' }}>
            {GPU_PRESETS.map(gpu => {
              const v = memoryLedger({
                paramsB: presetParamsB(preset),
                precisionBytes: precision,
                kvBytes: totalKVCacheBytes,
                gpuVramGb: gpu.vramGb
              }).verdict;
              const vs = VERDICT_STYLE[v] || VERDICT_STYLE.pass;
              return (
                <button
                  key={gpu.id}
                  onClick={() => {
                    // Ledger chip ids (rtx3060/dual3090/…) don't all exist in
                    // the planner's GPU_CATALOG — only select a real catalog
                    // id, else clear it so the planner shows "unknown" instead
                    // of a dangling select value.
                    setGpuId(gpuById(gpu.id) ? gpu.id : '');
                    setGpuVramGb(gpu.vramGb);
                  }}
                  className={gpuId === gpu.id ? 'active' : ''}
                  aria-pressed={gpuId === gpu.id}
                  style={{ fontFamily: 'var(--font-sans)', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span aria-hidden="true" style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: vs.color, boxShadow: `0 0 6px ${vs.color}`
                  }} />
                  {gpu.name} <span style={{ opacity: 0.65, fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>{gpu.vramGb}GB</span>
                </button>
              );
            })}
            <input
              type="number"
              min="1"
              value={gpuVramGb}
              aria-label={t('kvCache.gpuBudgetAria')}
              onChange={(e) => { setGpuId(''); setGpuVramGb(Number(e.target.value)); }}
              style={{ width: '5.25rem' }}
            />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', alignSelf: 'center' }}>GB</span>
          </div>

          {/* Stacked bar: weights + KV + overhead against the GPU's VRAM */}
          <div style={{
            position: 'relative', height: '26px', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-inset)', border: '1px solid var(--border)', overflow: 'hidden'
          }} role="img"
            aria-label={`${t('kvCache.ledgerUtilization', { pct: ledger.utilizationPct ?? '—', vram: safeGpuVram })} — ${verdictLabel[ledger.verdict] || ''}`}
          >
            <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
              <div style={{ width: segPct(ledger.weightsGb), background: 'var(--accent)' }} />
              <div style={{ width: segPct(ledger.kvCacheGb), background: 'var(--prefill)' }} />
              <div style={{ width: segPct(ledger.frameworkOverheadGb), background: 'var(--agent)' }} />
            </div>
            {/* VRAM limit marker */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: segPct(safeGpuVram),
              width: '2px', background: 'var(--text-main)', opacity: 0.9
            }} />
          </div>

          {/* Ledger rows */}
          <div style={{ marginTop: '12px', display: 'grid', gap: '6px', fontSize: '0.78rem', fontFamily: 'var(--font-mono)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--accent)' }}>■ {t('kvCache.ledgerWeights', { params: preset.params, prec: precision === 2 ? 'FP16' : precision === 1 ? 'FP8' : 'INT4' })}</span>
              <span>{ledger.weightsGb?.toFixed(2)} GB</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--prefill)' }}>■ {t('kvCache.ledgerKv')}</span>
              <span>{ledger.kvCacheGb?.toFixed(2)} GB</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--agent)' }}>■ {t('kvCache.ledgerOverhead', { pct: Math.round(DEFAULT_OVERHEAD_FRACTION * 100) })}</span>
              <span>{ledger.frameworkOverheadGb?.toFixed(2)} GB</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '6px', fontWeight: 600 }}>
              <span>{t('kvCache.ledgerTotal')}</span>
              <span>{ledger.totalGb?.toFixed(2)} GB · {t('kvCache.ledgerUtilization', { pct: ledger.utilizationPct ?? '—', vram: safeGpuVram })}</span>
            </div>
          </div>

          {/* Chart-to-table alternative (#75): the stacked bar's exact ledger
              values, visually hidden until keyboard focus (the GB numbers
              already render as text in the rows above). */}
          <ChartDataTable
            caption={t('chartTable.kvLedgerCaption')}
            rowHeaderLabel={t('chartTable.segment')}
            columns={[
              { key: 'gb', label: t('chartTable.gigabytes'), numeric: true },
              { key: 'share', label: t('chartTable.shareOfUsage'), numeric: true }
            ]}
            mode="sr-only"
            rows={[
              {
                id: 'weights',
                label: t('kvCache.ledgerWeights', { params: preset.params, prec: precision === 2 ? 'FP16' : precision === 1 ? 'FP8' : 'INT4' }),
                cells: {
                  gb: `${ledger.weightsGb?.toFixed(2)} GB`,
                  share: ledger.totalGb > 0 ? `${((ledger.weightsGb / ledger.totalGb) * 100).toFixed(1)}%` : '—'
                }
              },
              {
                id: 'kv',
                label: t('kvCache.ledgerKv'),
                cells: {
                  gb: `${ledger.kvCacheGb?.toFixed(2)} GB`,
                  share: ledger.totalGb > 0 ? `${((ledger.kvCacheGb / ledger.totalGb) * 100).toFixed(1)}%` : '—'
                }
              },
              {
                id: 'overhead',
                label: t('kvCache.ledgerOverhead', { pct: Math.round(DEFAULT_OVERHEAD_FRACTION * 100) }),
                cells: {
                  gb: `${ledger.frameworkOverheadGb?.toFixed(2)} GB`,
                  share: ledger.totalGb > 0 ? `${((ledger.frameworkOverheadGb / ledger.totalGb) * 100).toFixed(1)}%` : '—'
                }
              },
              {
                id: 'total',
                label: t('chartTable.totalRowLabel'),
                cells: {
                  gb: `${ledger.totalGb?.toFixed(2)} GB`,
                  share: t('chartTable.utilizationLabel', { pct: ledger.utilizationPct ?? '—', vram: safeGpuVram })
                }
              },
              {
                id: 'vramLimit',
                label: t('chartTable.vramLimitRowLabel'),
                cells: {
                  gb: `${safeGpuVram} GB`,
                  share: t('chartTable.vramLimit')
                }
              }
            ]}
          />

          {/* Verdict */}
          {ledger.verdict && (
            <div style={{
              marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
              background: VERDICT_STYLE[ledger.verdict].dim,
              border: `1px solid ${VERDICT_STYLE[ledger.verdict].border}`,
              borderRadius: 'var(--radius-md)', padding: '8px 12px'
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
                color: VERDICT_STYLE[ledger.verdict].color,
                border: `1px solid ${VERDICT_STYLE[ledger.verdict].color}`,
                borderRadius: 'var(--radius-xs)', padding: '2px 8px'
              }}>
                {verdictLabel[ledger.verdict]}
              </span>
              <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                {verdictDetail[ledger.verdict]}
                {ledger.verdict === 'pass' && ` — ${t('kvCache.ledgerFreeAfterReserve', { gb: ledger.freeAfterReserveGb?.toFixed(1), reserve: (safeGpuVram * SAFETY_HEADROOM_FRACTION).toFixed(1) })}`}
                {ledger.verdict !== 'pass' && ` — ${t('kvCache.ledgerOverReserve', { reserve: (safeGpuVram * SAFETY_HEADROOM_FRACTION).toFixed(1) })}`}
              </span>
            </div>
          )}
        </section>

        {/* Context exceeds model maximum warning */}
        {contextLength > preset.maxContext && (
          <p style={{ fontSize: '0.76rem', color: 'var(--agent)', background: 'var(--agent-dim)', border: '1px solid var(--agent-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', marginTop: '14px' }}>
            {t('kvCache.exceedsMaxContext', {
              tokens: `${formatTokens(contextLength)} tok`,
              model: preset.name,
              max: formatTokens(preset.maxContext)
            })}
          </p>
        )}

        {/* Source footnote */}
        <p style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', marginTop: '12px' }}>
          {preset.kvMode === 'csa_hca'
            ? t('kvCache.footnoteCsa')
            : t('kvCache.footnoteGeneric', {
              name: preset.name,
              source: preset.source,
              attentionType: preset.kvMode === 'mla' ? t('kvCache.attnMla')
                : preset.kvMode === 'sliding' ? t('kvCache.attnSliding')
                : preset.desc.includes('Hybrid') ? t('kvCache.attnHybrid')
                : t('kvCache.attnGqa')
            })}
        </p>

      </section>

      {/* ---- VRAM Budget Planner (issue #45): weights + KV + overhead vs GPU ---- */}
      <section className="panel" aria-label={t('kvCache.plannerPanelTitle')}>
        <h2 className="panel-title" style={{ marginBottom: '12px' }}>
          <Gauge size={16} />
          <span>{t('kvCache.plannerPanelTitle')}</span>
        </h2>

        <p className="hint-text" style={{ marginBottom: '18px', maxWidth: '900px' }}>
          {t('kvCache.plannerIntro')}
        </p>

        {/* Planner controls */}
        <div className="grid-auto" style={{ '--grid-min': '15rem', marginBottom: '18px' }}>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('kvCache.weightPrecision')}</span>
              <span className="field-value" style={{ color: 'var(--prefill)' }}>
                {usesMeasuredWeights
                  ? `${fmtGb(weightsGb)} GB · measured`
                  : preset.params}
              </span>
            </div>
            <div className="seg" role="group" aria-label={t('kvCache.weightPrecisionAria')} style={{ marginTop: '2px' }}>
              {WEIGHT_PRECISIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setWeightPrecisionId(opt.id)}
                  disabled={usesMeasuredWeights}
                  className={weightPrecisionId === opt.id && !usesMeasuredWeights ? 'active' : ''}
                  aria-pressed={!usesMeasuredWeights && weightPrecisionId === opt.id}
                  style={{ flex: 1 }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {!usesMeasuredWeights && paramsB !== null && (
              <p style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', margin: '8px 0 0', fontFamily: 'var(--font-mono)' }}>
                {t('kvCache.weightsSource', {
                  params: preset.params,
                  bpw: weightPreset.bpw,
                  gb: `${fmtGb(estimatedWeightsGiB || 0)} GB`
                })}
              </p>
            )}
            <label className="field-label" htmlFor="lmx-weights-override" style={{ display: 'block', marginTop: '10px', fontSize: '0.7rem', opacity: 0.85 }}>
              {t('kvCache.weightsOverrideLabel')}
            </label>
            <input
              id="lmx-weights-override"
              type="number"
              min="0"
              step="0.5"
              placeholder={estimatedWeightsGiB !== null ? estimatedWeightsGiB.toFixed(1) : ''}
              value={weightsOverrideGb || ''}
              aria-label={t('kvCache.weightsOverrideAria')}
              onChange={(e) => setWeightsOverrideGb(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: '6.875rem', marginTop: '4px' }}
            />
            <p style={{ fontSize: '0.66rem', color: 'var(--text-subtle)', margin: '6px 0 0' }}>
              {t('kvCache.weightsOverrideHint')}
            </p>
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('kvCache.overheadLabel')}</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{overheadPct}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="40"
              step="1"
              value={overheadPct}
              aria-label={t('kvCache.overheadAria')}
              aria-valuetext={`${overheadPct}% memory overhead`}
              onChange={(e) => setOverheadPct(Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.64rem', color: 'var(--text-subtle)', marginTop: '2px' }}>
              <span>0%</span>
              <span>vLLM / llama.cpp: 10–20%</span>
              <span>40%</span>
            </div>
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('kvCache.targetGpu')}</span>
              {/* #988: show the effective budget VRAM (override-aware), matching the ledger */}
              <span className="field-value" style={{ color: 'var(--accent)' }}>{budgetVramGb != null ? `${fmtGb(budgetVramGb)} GB` : '—'}</span>
            </div>
            <select
              value={gpuId}
              aria-label={t('kvCache.targetGpuAria')}
              onChange={(e) => applyGpuPatch(gpuSelectionPatch(e.target.value, GPU_CATALOG))}
              style={{ width: '100%', marginTop: '4px' }}
            >
              {GPU_CATALOG.map(gpu => (
                <option key={gpu.id} value={gpu.id}>
                  {gpu.name} · {gpu.vramGb} GB{gpu.unified ? ' · unified' : ''}
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* Stacked ledger bar */}
        {selectedGpu && (
          <div style={{ marginBottom: '18px' }}>
            <div style={{ position: 'relative', height: '34px', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {(() => {
                const scaleMax = Math.max(budget.totalGb, budgetVramGb);
                const pct = gb => Math.min(100, (gb / scaleMax) * 100);
                const limitPos = pct(budgetVramGb);
                return (
                  <>
                    <div title={t('kvCache.ledgerWeights')} style={{ position: 'absolute', inset: 0, width: `${pct(weightsGb)}%`, background: 'linear-gradient(180deg, var(--prefill), color-mix(in srgb, var(--prefill) 70%, black))' }} />
                    <div title={t('kvCache.ledgerKv')} style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct(weightsGb)}%`, width: `${Math.max(0, pct(weightsGb + totalKVCacheGB) - pct(weightsGb))}%`, background: 'var(--decode)' }} />
                    <div title={t('kvCache.ledgerOverhead', { pct: overheadPct })} style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct(weightsGb + totalKVCacheGB)}%`, width: `${Math.max(0, pct(budget.totalGb) - pct(weightsGb + totalKVCacheGB))}%`, background: 'repeating-linear-gradient(45deg, var(--agent), var(--agent) 4px, transparent 4px, transparent 8px)', backgroundColor: 'color-mix(in srgb, var(--agent) 35%, transparent)' }} />
                    <div title={t('kvCache.gpuLimitMarker', { gb: `${fmtGb(budgetVramGb)} GB` })} style={{ position: 'absolute', top: 0, bottom: 0, left: `${limitPos}%`, width: '2px', background: 'white', boxShadow: '0 0 6px rgba(255,255,255,0.9)' }} />
                  </>
                );
              })()}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginTop: '8px', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
              <span><span style={{ display: 'inline-block', width: '9px', height: '9px', background: 'var(--prefill)', marginRight: '5px', borderRadius: '2px' }} />{t('kvCache.ledgerWeights')} {fmtGb(weightsGb)} GB</span>
              <span><span style={{ display: 'inline-block', width: '9px', height: '9px', background: 'var(--decode)', marginRight: '5px', borderRadius: '2px' }} />{t('kvCache.ledgerKv')} {fmtGb(totalKVCacheGB)} GB</span>
              <span><span style={{ display: 'inline-block', width: '9px', height: '9px', border: '1px solid var(--agent)', marginRight: '5px', borderRadius: '2px' }} />{t('kvCache.ledgerOverhead', { pct: overheadPct })} {fmtGb(budget.overheadGb)} GB</span>
              <span style={{ opacity: 0.75 }}>{t('kvCache.gpuLimitMarker', { gb: `${fmtGb(budgetVramGb)} GB` })}</span>
            </div>
          </div>
        )}

        {/* Ledger totals + verdict */}
        <div className="metric-grid">
          <div className="metric" style={{ borderInlineStartColor: 'var(--accent)' }}>
            <div className="metric-label">{t('kvCache.ledgerTotal')}</div>
            <div className="metric-value" style={{ color: 'var(--accent)' }}>{fmtGb(budget.totalGb)} GB</div>
          </div>

          <div className="metric" style={{ borderInlineStartColor: budget.headroomGb !== null && budget.headroomGb >= 0 ? 'var(--decode)' : 'var(--danger)' }}>
            <div className="metric-label">
              {budget.headroomGb !== null && budget.headroomGb < 0
                ? t('kvCache.ledgerOverBudget', { gb: `${fmtGb(-budget.headroomGb)} GB` })
                : t('kvCache.ledgerHeadroom', { gpu: selectedGpu ? selectedGpu.name : '' })}
            </div>
            <div className="metric-value" style={{
              color: budget.headroomGb === null ? 'var(--text-subtle)'
                : budget.headroomGb >= 0 ? 'var(--decode)' : 'var(--danger)'
            }}>
              {budget.headroomGb === null ? '—' : `${budget.headroomGb >= 0 ? '+' : ''}${fmtGb(budget.headroomGb)} GB`}
            </div>
          </div>

          <div className="metric" style={{ borderInlineStartColor: budget.verdict === 'pass' ? 'var(--decode)' : budget.verdict === 'warn' ? 'var(--warn)' : budget.verdict === 'fail' ? 'var(--danger)' : 'var(--text-subtle)' }}>
            <div className="metric-label">{t('kvCache.verdictBadgeAria')}</div>
            <div className="metric-value">
              <span style={{
                display: 'inline-block',
                padding: '6px 12px',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.78rem',
                fontWeight: 600,
                // verdict === null (no catalog GPU selected — custom VRAM typed
                // in the ledger above) is "unknown", never a red FAIL.
                color: budget.verdict === 'pass' ? 'var(--decode)' : budget.verdict === 'warn' ? 'var(--warn)' : budget.verdict === 'fail' ? 'var(--danger)' : 'var(--text-subtle)',
                border: `1px solid ${budget.verdict === 'pass' ? 'var(--decode-border)' : budget.verdict === 'warn' ? 'var(--agent-border)' : budget.verdict === 'fail' ? 'var(--danger)' : 'var(--border)'}`,
                background: budget.verdict === 'pass' ? 'var(--decode-dim)' : budget.verdict === 'warn' ? 'var(--agent-dim)' : budget.verdict === 'fail' ? 'rgba(248,113,113,0.10)' : 'transparent'
              }}>
                {budget.verdict === 'pass' ? t('kvCache.verdictPass')
                  : budget.verdict === 'warn' ? t('kvCache.verdictWarn')
                  : budget.verdict === 'fail' ? t('kvCache.verdictFail')
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Per-GPU pass/fail/warn verdicts */}
        <p className="field-label" style={{ margin: '18px 0 2px', fontSize: '0.74rem' }}>{t('kvCache.perGpuHeading')}</p>
        <p style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', margin: '0 0 8px' }}>{t('kvCache.perGpuIntro')}</p>
        <div className="seg" role="group" aria-label={t('kvCache.perGpuHeading')} style={{ flexWrap: 'wrap', gap: '2px' }}>
          {gpuVerdicts.map(({ gpu, verdict }) => (
            <button
              key={gpu.id}
              onClick={() => applyGpuPatch(gpuSelectionPatch(gpu.id, GPU_CATALOG))}
              data-tooltip={`${t('kvCache.gpuVerdictAria', {
                name: gpu.name,
                verdict: verdict === 'pass' ? t('kvCache.verdictPass') : verdict === 'warn' ? t('kvCache.verdictWarn') : t('kvCache.verdictFail')
              })}`}
              className={gpuId === gpu.id ? 'active' : ''}
              aria-pressed={gpuId === gpu.id}
              style={{ fontFamily: 'var(--font-sans)', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: '7px' }}
            >
              <span aria-hidden="true" style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: verdict === 'pass' ? 'var(--decode)' : verdict === 'warn' ? 'var(--warn)' : 'var(--danger)',
                boxShadow: `0 0 4px ${verdict === 'pass' ? 'var(--decode)' : verdict === 'warn' ? 'var(--warn)' : 'var(--danger)'}`
              }} />
              {gpu.name}
              <span style={{ opacity: 0.65, fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>{gpu.vramGb}GB</span>
            </button>
          ))}
        </div>

        {selectedGpu && selectedGpu.unified && (
          <p style={{ fontSize: '0.72rem', color: 'var(--agent)', background: 'var(--agent-dim)', border: '1px solid var(--agent-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', marginTop: '14px' }}>
            {t('kvCache.unifiedNote')}
          </p>
        )}

        </section>

        {/* Multi-GPU split planner (#48) — reuses this panel's KV total */}
        <MultiGpuPlanner preset={preset} totalKVCacheBytes={totalKVCacheBytes} />

    </div>
  );
}
