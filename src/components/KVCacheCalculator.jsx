import React, { useState, useEffect } from 'react';
import { HardDrive } from 'lucide-react';
import { formatTokens } from '../utils/presets';
import { readParam, readParamNum, writeParams } from '../utils/urlState';

// KV-cache geometry pulled from each model's actual config.json on HuggingFace.
//   kvMode 'gqa' -> bytes/token/layer = 2 * kvHeads * headDim * bytes
//   kvMode 'mla' -> bytes/token/layer = (kvLoraRank + qkRopeHeadDim) * bytes
//                    (Multi-head Latent Attention: only the compressed latent +
//                     RoPE part is cached per token)
//   kvLayers     -> layers that actually store a KV cache (linear/KDA layers
//                    don't; e.g. Kimi-K3 stores KV only on 24 full-attn layers)
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
    desc: 'GQA · 8 KV heads × 128'
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
    desc: 'GQA · 8 KV heads × 128'
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
    desc: 'GQA · 8 KV heads × 128'
  },
  {
    id: 'dsv4flash',
    name: 'DeepSeek-V4-Flash-0731',
    params: '284B',
    layers: 43,
    kvHeads: 1,
    headDim: 512,
    kvMode: 'gqa',
    kvLayers: 43,
    maxContext: 1048576,
    desc: 'DSA · 1 KV head × 512'
  },
  {
    id: 'museglimmer',
    name: 'Muse-Glimmer-30B',
    params: '28B',
    layers: 52,
    kvHeads: 2,
    headDim: 128,
    kvMode: 'gqa',
    kvLayers: 52,
    maxContext: 131072,
    desc: 'GQA · 2 KV heads × 128 · sliding window'
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
    desc: 'KDA · MLA · 24 full-attn layers'
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
    desc: 'GQA · 8 KV heads × 64'
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
    desc: 'DSA · MLA · IndexShare'
  }
];

function kvBytesPerToken(preset, precisionBytes) {
  if (preset.kvMode === 'mla') {
    return preset.kvLayers * (preset.kvLoraRank + preset.qkRopeHeadDim) * precisionBytes;
  }
  return 2 * preset.kvLayers * preset.kvHeads * preset.headDim * precisionBytes;
}

function kvFormula(preset) {
  if (preset.kvMode === 'mla') {
    return `${preset.kvLayers} layers × (${preset.kvLoraRank} latent + ${preset.qkRopeHeadDim} rope) × ${preset.kvLayers === preset.layers ? '' : `${preset.kvLayers}/${preset.layers} full-attn `}bytes`;
  }
  return `2 × ${preset.kvLayers} layers × ${preset.kvHeads} KV heads × ${preset.headDim} dim × bytes`;
}

export default function KVCacheCalculator() {
  const [modelPreset, setModelPreset] = useState(() => readParam('model') || 'llama70b');
  const [contextLength, setContextLength] = useState(() => readParamNum('ctx', 32768));
  const [precision, setPrecision] = useState(() => readParamNum('prec', 2)); // 2 bytes = FP16/BF16, 1 byte = FP8/INT8, 0.5 = INT4
  const [batchSize, setBatchSize] = useState(() => readParamNum('batch', 1));

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({ model: modelPreset, ctx: contextLength, prec: precision, batch: batchSize });
  }, [modelPreset, contextLength, precision, batchSize]);

  const preset = MODEL_PRESETS.find(p => p.id === modelPreset) || MODEL_PRESETS[0];

  // KV Cache size per token in bytes (per sequence)
  const bytesPerTokenSingleSeq = kvBytesPerToken(preset, precision);
  const totalKVCacheBytes = bytesPerTokenSingleSeq * contextLength * batchSize;
  const totalKVCacheGB = totalKVCacheBytes / (1024 * 1024 * 1024);
  const totalKVCacheMB = totalKVCacheBytes / (1024 * 1024);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px' }}>
      
      <div className="material-card" style={{ padding: '20px', background: '#FFFFFF' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0F172A', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HardDrive size={22} color="#7C3AED" />
          <span>Interactive KV Cache Memory (VRAM) Estimator</span>
        </h2>

        <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '20px' }}>
          Every prompt and generated token creates Key and Value matrices stored in GPU VRAM during prefill and decode phases. Model geometry pulled from official HuggingFace config.json.
        </p>

        {/* Model Presets */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '24px' }}>
          {MODEL_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => setModelPreset(p.id)}
              title={p.desc}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: modelPreset === p.id ? '1px solid #7C3AED' : '1px solid #E2E8F0',
                background: modelPreset === p.id ? '#F5F3FF' : '#FFFFFF',
                color: modelPreset === p.id ? '#7C3AED' : '#475569',
                fontWeight: '700',
                fontSize: '0.8rem',
                cursor: 'pointer'
              }}
            >
              {p.name} <span style={{ opacity: 0.7, fontWeight: '600' }}>({p.params})</span>
            </button>
          ))}
        </div>

        {/* Parameter Sliders */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          
          <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>Context Length</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#7C3AED' }}>{formatTokens(contextLength)} tok</span>
            </div>
            <input
              type="range"
              min="1024"
              max={Math.min(1048576, preset.maxContext)}
              step="1024"
              value={Math.min(contextLength, preset.maxContext)}
              onChange={(e) => setContextLength(Number(e.target.value))}
            />
          </div>

          <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>Concurrent Batch Size</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#2563EB' }}>{batchSize} sequences</span>
            </div>
            <input
              type="range"
              min="1"
              max="64"
              step="1"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
            />
          </div>

          <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>KV Cache Precision</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#059669' }}>
                {precision === 2 ? 'FP16 / BF16 (2 bytes)' : precision === 1 ? 'FP8 / INT8 (1 byte)' : 'INT4 (0.5 byte)'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
              {[
                { val: 2, label: 'FP16 (2B)' },
                { val: 1, label: 'FP8 (1B)' },
                { val: 0.5, label: 'INT4 (0.5B)' }
              ].map(opt => (
                <button
                  key={opt.val}
                  onClick={() => setPrecision(opt.val)}
                  style={{
                    flex: 1,
                    padding: '6px',
                    borderRadius: '6px',
                    border: '1px solid #CBD5E1',
                    background: precision === opt.val ? '#059669' : '#FFFFFF',
                    color: precision === opt.val ? '#FFFFFF' : '#475569',
                    fontSize: '0.75rem',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Results Banner */}
        <div style={{
          padding: '20px',
          borderRadius: '14px',
          background: 'linear-gradient(135deg, #F5F3FF 0%, #EFF6FF 100%)',
          border: '1px solid #DDD6FE',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '20px',
          textAlign: 'center'
        }}>
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#6D28D9', textTransform: 'uppercase' }}>
              KV Cache Memory / Token
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: '800', color: '#7C3AED', marginTop: '4px' }}>
              {(bytesPerTokenSingleSeq / 1024).toFixed(1)} KB
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1E40AF', textTransform: 'uppercase' }}>
              Total KV Cache VRAM Required
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: '800', color: '#2563EB', marginTop: '4px' }}>
              {totalKVCacheGB >= 1 ? `${totalKVCacheGB.toFixed(2)} GB` : `${totalKVCacheMB.toFixed(0)} MB`}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#065F46', textTransform: 'uppercase' }}>
              KV Formula ({preset.kvMode === 'mla' ? 'MLA' : 'GQA'})
            </div>
            <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: '#065F46', marginTop: '6px' }}>
              {kvFormula(preset)}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
