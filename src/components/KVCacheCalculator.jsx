import React, { useState, useEffect } from 'react';
import { HardDrive } from 'lucide-react';
import { formatTokens } from '../utils/presets';
import { readParam, readParamNum, writeParams } from '../utils/urlState';
import Metric from './Metric';
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
      // Anchor: paper Fig. 1 @ 1M context = kvBytesAt1M at ~1 B/elem. Scale by
      // precision (FP8 base) and linearly with context (approximation; the real
      // curve is slightly sublinear due to the fixed SWA window and compression
      // granularity, but the paper does not give a closed-form per-token size).
      const base = (preset.kvBytesAt1M / 1048576) * (precisionBytes / 1);
      return base * (contextLength / 1048576);
    }

    default:
      return 0;
  }
}

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

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({ model: modelPreset, ctx: contextLength, prec: precision, batch: batchSize });
  }, [modelPreset, contextLength, precision, batchSize]);

  const preset = MODEL_PRESETS.find(p => p.id === modelPreset) || MODEL_PRESETS[0];

  // Sanitize typed inputs for math (number fields allow 0/negative values)
  const safeContext = Math.max(0, contextLength || 0);
  const safeBatch = Math.max(0, batchSize || 0);

  // KV Cache size per token in bytes (per sequence)
  const bytesPerTokenSingleSeq = kvBytesPerToken(preset, precision, safeContext);
  const totalKVCacheBytes = bytesPerTokenSingleSeq * safeContext * safeBatch;
  const totalKVCacheGB = totalKVCacheBytes / (1024 * 1024 * 1024);
  const totalKVCacheMB = totalKVCacheBytes / (1024 * 1024);

  return (
    <div className="stack">

      <section className="panel" aria-label={t('kvCache.panelAria')}>
        <h2 className="panel-title" style={{ marginBottom: '12px' }}>
          <HardDrive size={16} />
          <span>{t('kvCache.panelTitle')}</span>
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
        <div className="grid-auto" style={{ '--grid-min': '240px', marginBottom: '18px' }}>

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
                onChange={(e) => setContextLength(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={contextLength}
                aria-label={t('kvCache.contextValueAria')}
                onChange={(e) => setContextLength(Number(e.target.value))}
                style={{ width: '90px' }}
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
                onChange={(e) => setBatchSize(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={batchSize}
                aria-label={t('kvCache.batchValueAria')}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                style={{ width: '64px' }}
              />
            </div>
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('kvCache.kvPrecision')}</span>
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

    </div>
  );
}
