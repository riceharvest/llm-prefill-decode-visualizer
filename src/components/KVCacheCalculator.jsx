import React, { useState } from 'react';
import { HardDrive } from 'lucide-react';
import { formatTokens } from '../utils/presets';

export default function KVCacheCalculator() {
  const [modelPreset, setModelPreset] = useState('llama70b');
  const [numLayers, setNumLayers] = useState(80);
  const [kvHeads, setKvHeads] = useState(8); // Grouped-Query Attention (GQA) kv heads
  const [headDim, setHeadDim] = useState(128);
  const [contextLength, setContextLength] = useState(32768);
  const [precision, setPrecision] = useState(2); // 2 bytes = FP16/BF16, 1 byte = FP8/INT8, 0.5 = INT4
  const [batchSize, setBatchSize] = useState(1);

  const applyModelPreset = (presetKey) => {
    setModelPreset(presetKey);
    if (presetKey === 'llama8b') {
      setNumLayers(32);
      setKvHeads(8);
      setHeadDim(128);
    } else if (presetKey === 'llama70b') {
      setNumLayers(80);
      setKvHeads(8);
      setHeadDim(128);
    } else if (presetKey === 'qwen72b') {
      setNumLayers(80);
      setKvHeads(8);
      setHeadDim(128);
    } else if (presetKey === 'mistral7b') {
      setNumLayers(32);
      setKvHeads(8);
      setHeadDim(128);
    }
  };

  // KV Cache size per token in bytes = 2 * numLayers * kvHeads * headDim * precision
  const bytesPerTokenSingleSeq = 2 * numLayers * kvHeads * headDim * precision;
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
          Every prompt and generated token creates Key and Value matrices stored in GPU VRAM during prefill and decode phases.
        </p>

        {/* Model Presets */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '24px' }}>
          {[
            { id: 'llama70b', label: 'LLaMA-3.3 70B (GQA 8 KV heads)' },
            { id: 'llama8b', label: 'LLaMA-3.1 8B (GQA 8 KV heads)' },
            { id: 'mistral7b', label: 'Mistral 7B (GQA 8 KV heads)' }
          ].map(p => (
            <button
              key={p.id}
              onClick={() => applyModelPreset(p.id)}
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
              {p.label}
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
              max="131072"
              step="1024"
              value={contextLength}
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
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>Precision Data Type</span>
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
              VRAM Formula
            </div>
            <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: '#065F46', marginTop: '6px' }}>
              2 × {numLayers} layers × {kvHeads} KV heads × {headDim} dim × {precision}B
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
