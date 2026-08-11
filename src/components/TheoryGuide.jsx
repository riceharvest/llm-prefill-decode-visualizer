import React from 'react';
import { HelpCircle, Gauge, Zap, Play } from 'lucide-react';
import { demoUrl } from '../utils/urlState';

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

        {/* Community FAQ — sourced from recurring questions on X */}
        <div style={{ background: '#F8FAFC', padding: '20px', borderRadius: '14px', border: '1px solid #E2E8F0' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: '#334155', marginBottom: '6px' }}>
            ❓ Community FAQ — Speed Setups
          </h3>
          <p style={{ fontSize: '0.78rem', color: '#64748B', marginBottom: '16px' }}>
            Compiled from the questions local-LLM users most often ask on X. Use the tabs above to reproduce each scenario.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              {
                q: 'Why is my first token so slow, then the rest are fast?',
                a: 'That is normal. The first token waits for the prefill phase: the whole prompt is processed at once (compute-bound). On a mid GPU that is hundreds of ms. After that, decode runs at one token per step, so it feels fast per token — but every token reads the full model weights from VRAM, which is why decode is bandwidth-bound.',
                demo: { tab: 'single', prefill: 3800, decode: 105, prompt: 8192, output: 256, sim: 5 }
              },
              {
                q: 'What is a good tok/s for a local model?',
                a: 'It depends on the model size and your memory bandwidth. Rule of thumb: decode speed ≈ usable VRAM bandwidth ÷ model size in bytes. A 24 GB/s-class card with a 4-bit 8B model does roughly 30-60 tok/s. If you are below ~10 tok/s on an 8B, something is off (CPU offload, no GPU layers, wrong build).',
                demo: { tab: 'compare', hwA: 'rtx3060_entry', hwB: 'rtx4090_exl2', cp: 4096, co: 512 }
              },
              {
                q: 'Why is decode so much slower than prefill?',
                a: 'Prefill is a big parallel matrix-matrix multiply (GEMM) — perfect for tensor cores. Decode is one matrix-vector multiply (GEMV) per token and is dominated by reading weights + KV cache from VRAM. You cannot fix decode speed with more compute; you need more memory bandwidth or a smaller/faster quantized model.',
                demo: { tab: 'single', prefill: 3800, decode: 105, prompt: 4096, output: 2048, sim: 20 }
              },
              {
                q: 'How much VRAM do I need for model + context?',
                a: 'VRAM ≈ weights + KV cache + ~1-2 GB overhead. Weights: model bytes × quant size (e.g. 70B at Q4 ≈ 35-40 GB). KV cache: use the KV Cache Calculator tab — a dense 70B at 32k context FP16 is about 10 GB, so it often does not fit on 24 GB together with weights. Lower KV precision (FP8/INT4) or a shorter context is the lever.',
                demo: { tab: 'kvcache', model: 'llama70b', ctx: 32768, prec: 2 }
              },
              {
                q: 'Why does my context length run out of memory?',
                a: 'Because KV cache grows linearly with context and is allocated for every layer. Long prompts with agents (tool outputs, history) fill it fast. Solutions: quantize the KV cache (--cache-type-k/v q8_0 or q4_0), shorten the system prompt, enable prefix caching, or pick a model with MLA / linear attention (they need far less KV per token).',
                demo: { tab: 'kvcache', model: 'llama70b', ctx: 131072, prec: 0.5 }
              },
              {
                q: 'Does flash attention speed up prefill or decode?',
                a: 'Flash attention mainly accelerates prefill and long-context attention compute, and it reduces memory use. It has little effect on the decode bottleneck (bandwidth-bound GEMV). It can also free VRAM, which indirectly lets you use a bigger context. Benchmark both — the gain is model- and context-dependent.',
                demo: { tab: 'agentic', turns: 6, sprompt: 4096, tool: 1024, thought: 256, sim: 20 }
              },
              {
                q: 'Is a higher quant always slower?',
                a: 'Usually yes but not by much. Q8 vs Q4 changes decode speed roughly by the bandwidth ratio of the sizes read per token. On a 4090-class card, 70B Q4 vs Q8 can differ 10-30%. Quality also differs: use the largest quant that fits your VRAM budget — Q4_K_M is the common sweet spot.',
                demo: { tab: 'compare', hwA: 'rtx4090_exl2', hwB: 'dual_rtx3090', cp: 8192, co: 1024 }
              },
              {
                q: 'Why is my Mac / CPU box slower than the GPU numbers I see?',
                a: 'Unified memory and system RAM have far lower bandwidth than GDDR/HBM (e.g. ~100 GB/s vs 1000+ GB/s). Decode speed tracks that bandwidth. Also check the backend actually uses GPU layers (Metal/CUDA) and not CPU fallback, and that you are comparing the same quant and context.',
                demo: { tab: 'compare', hwA: 'mac_ultra', hwB: 'rtx4090_exl2', cp: 8192, co: 512 }
              }
            ].map((item, i) => (
              <details
                key={i}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '10px',
                  padding: '12px 16px'
                }}
              >
                <summary style={{ fontWeight: '700', fontSize: '0.88rem', color: '#0F172A', cursor: 'pointer' }}>
                  {item.q}
                </summary>
                <p style={{ fontSize: '0.82rem', color: '#475569', marginTop: '8px', lineHeight: 1.6 }}>
                  {item.a}
                </p>
                {item.demo && (
                  <button
                    onClick={() => { window.location.href = demoUrl(item.demo); }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginTop: '10px',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #4F46E5 0%, #3B82F6 100%)',
                      color: '#FFFFFF',
                      fontWeight: '700',
                      fontSize: '0.78rem',
                      cursor: 'pointer'
                    }}
                  >
                    <Play size={13} />
                    Try it in the visualizer
                  </button>
                )}
              </details>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
