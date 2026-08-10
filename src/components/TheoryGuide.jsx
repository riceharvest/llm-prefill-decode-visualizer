import React from 'react';
import { HelpCircle, Gauge, Zap } from 'lucide-react';

export default function TheoryGuide() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px' }}>
      
      <div className="material-card" style={{ padding: '24px', background: '#FFFFFF' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#0F172A', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <HelpCircle size={24} color="#4F46E5" />
          <span>LLM Inference Mechanics: Prefill vs. Decode Explained</span>
        </h2>

        {/* Comparative Dual Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px', marginBottom: '28px' }}>
          
          {/* Prefill Explanation */}
          <div style={{ padding: '20px', borderRadius: '14px', background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Zap size={20} color="#2563EB" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: '#1E40AF' }}>
                1. Prefill Phase (Prompt Ingestion)
              </h3>
            </div>
            
            <p style={{ fontSize: '0.85rem', color: '#1E3A8A', lineHeight: 1.6, marginBottom: '14px' }}>
              During prefill, the LLM processes the entire input prompt (all N<sub>prompt</sub> tokens) at once. The attention mechanism builds the initial Key-Value (KV) cache for every prompt token.
            </p>

            <ul style={{ fontSize: '0.82rem', color: '#1E3A8A', display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '18px' }}>
              <li><strong>Bottleneck:</strong> Compute-bound (Tensor Cores / FLOPs).</li>
              <li><strong>Operation:</strong> Matrix-Matrix Multiplication (GEMM). High arithmetic intensity.</li>
              <li><strong>User Metric:</strong> <strong>TTFT (Time-To-First-Token)</strong>:
                <div style={{ fontFamily: 'var(--font-mono)', background: '#FFFFFF', padding: '6px 10px', borderRadius: '6px', border: '1px solid #93C5FD', margin: '6px 0', color: '#1D4ED8', fontWeight: '700' }}>
                  TTFT = Prompt Tokens / Prefill Speed
                </div>
              </li>
            </ul>
          </div>

          {/* Decode Explanation */}
          <div style={{ padding: '20px', borderRadius: '14px', background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Gauge size={20} color="#059669" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: '#065F46' }}>
                2. Decode Phase (Autoregressive Generation)
              </h3>
            </div>
            
            <p style={{ fontSize: '0.85rem', color: '#064E3B', lineHeight: 1.6, marginBottom: '14px' }}>
              During decode, tokens are generated strictly one-by-one. For every single generated token, the GPU must read all model parameters and previous KV cache vectors from VRAM into compute registers.
            </p>

            <ul style={{ fontSize: '0.82rem', color: '#064E3B', display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '18px' }}>
              <li><strong>Bottleneck:</strong> Memory Bandwidth-bound (VRAM Memory Transfer rate).</li>
              <li><strong>Operation:</strong> Matrix-Vector Multiplication (GEMV). Low arithmetic intensity.</li>
              <li><strong>User Metric:</strong> <strong>TPOT (Time-Per-Output-Token)</strong>:
                <div style={{ fontFamily: 'var(--font-mono)', background: '#FFFFFF', padding: '6px 10px', borderRadius: '6px', border: '1px solid #6EE7B7', margin: '6px 0', color: '#047857', fontWeight: '700' }}>
                  TPOT = 1000 / Decode Speed (ms/token)
                </div>
              </li>
            </ul>
          </div>

        </div>

        {/* Agentic Loop Theory Section */}
        <div style={{ background: '#FFFBEB', padding: '20px', borderRadius: '14px', border: '1px solid #FDE68A', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: '#92400E', marginBottom: '10px' }}>
            🤖 Why Agentic Loops Require Walltime Measurement Per Turn
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#78350F', lineHeight: 1.6, marginBottom: '12px' }}>
            An AI Agent operates in a loop: <strong>Plan → Tool Call → Tool Execution → Process Result → Next Action</strong>.
            With each turn, the conversation context grows larger because previous tool inputs and outputs are appended to the system prompt.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #FCD34D' }}>
              <strong style={{ fontSize: '0.82rem', color: '#92400E' }}>Without Prefix Caching:</strong>
              <p style={{ fontSize: '0.78rem', color: '#78350F', marginTop: '4px' }}>
                On turn k, the inference server must re-prefill the entire accumulated history P<sub>k</sub>. Prefill latency increases linearly/quadratically per turn, causing high turn walltime!
              </p>
            </div>
            <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #FCD34D' }}>
              <strong style={{ fontSize: '0.82rem', color: '#92400E' }}>With Prefix Caching (RadixAttention):</strong>
              <p style={{ fontSize: '0.78rem', color: '#78350F', marginTop: '4px' }}>
                The server reuses existing KV cache blocks for turns 1..k-1. It only prefills the NEW tool response tokens ΔP<sub>k</sub>, keeping turn walltimes consistently low!
              </p>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
