import React from 'react';
import { HelpCircle, Gauge, Zap, Play, Bot } from 'lucide-react';
import { demoUrl } from '../utils/urlState';

export default function TheoryGuide() {
  // Glossary popovers across the app deep-link here via ?tab=theory#<anchor>;
  // scroll to the anchored section once this tab has mounted.
  React.useEffect(() => {
    const id = window.location.hash.replace('#', '');
    if (!id) return;
    // Wait a frame so the tab content is laid out before scrolling.
    const t = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(t);
  }, []);
  const bulletStyle = { fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '18px', lineHeight: 1.55 };
  const formulaStyle = {
    fontFamily: 'var(--font-mono)',
    background: 'var(--bg-inset)',
    padding: '6px 10px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    margin: '6px 0',
    fontWeight: 600,
    fontSize: '0.8rem'
  };

  return (
    <div className="stack">

      <section className="panel" aria-label="Theory and equations">
        <h2 className="panel-title" style={{ marginBottom: '16px' }}>
          <HelpCircle size={16} />
          <span>LLM Inference Mechanics · Prefill vs Decode</span>
        </h2>

        {/* Comparative Dual Cards */}
        <div className="grid-auto" style={{ '--grid-min': '320px', marginBottom: '16px' }}>

          {/* Prefill Explanation */}
          <div id="theory-prefill" className="panel-inset theory-anchor" style={{ borderLeft: '2px solid var(--prefill)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Zap size={16} style={{ color: 'var(--prefill)' }} />
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--prefill)' }}>
                1 · Prefill — prompt ingestion
              </h3>
            </div>

            <p className="hint-text" style={{ marginBottom: '12px' }}>
              During prefill, the LLM processes the entire input prompt (all N<sub>prompt</sub> tokens) at once. The attention mechanism builds the initial Key-Value (KV) cache for every prompt token.
            </p>

            <ul style={bulletStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Bottleneck:</strong> compute-bound (tensor cores / FLOPs).</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Operation:</strong> matrix-matrix multiplication (GEMM). High arithmetic intensity.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>User metric — TTFT (time to first token):</strong>
                <div style={{ ...formulaStyle, color: 'var(--prefill)' }}>
                  TTFT = prompt tokens / prefill speed
                </div>
              </li>
            </ul>
          </div>

          {/* Decode Explanation */}
          <div id="theory-decode" className="panel-inset theory-anchor" style={{ borderLeft: '2px solid var(--decode)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Gauge size={16} style={{ color: 'var(--decode)' }} />
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--decode)' }}>
                2 · Decode — autoregressive generation
              </h3>
            </div>

            <p className="hint-text" style={{ marginBottom: '12px' }}>
              During decode, tokens are generated strictly one by one. For every generated token, the GPU must read all model parameters and previous KV cache vectors from VRAM into compute registers.
            </p>

            <ul style={bulletStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Bottleneck:</strong> memory bandwidth-bound (VRAM transfer rate).</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Operation:</strong> matrix-vector multiplication (GEMV). Low arithmetic intensity.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>User metric — TPOT (time per output token):</strong>
                <div style={{ ...formulaStyle, color: 'var(--decode)' }}>
                  TPOT = 1000 / decode speed (ms/token)
                </div>
              </li>
            </ul>
          </div>

        </div>

        {/* Agentic Loop Theory Section */}
        <div id="theory-agentic" className="panel-inset theory-anchor" style={{ borderLeft: '2px solid var(--agent)', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--agent)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={16} />
            Why agentic loops require per-turn walltime measurement
          </h3>
          <p className="hint-text" style={{ marginBottom: '12px' }}>
            An AI agent operates in a loop: <strong style={{ color: 'var(--text-main)' }}>Plan → Tool Call → Tool Execution → Process Result → Next Action</strong>.
            With each turn, the conversation context grows because previous tool inputs and outputs are appended to the prompt.
          </p>

          <div className="grid-auto" style={{ '--grid-min': '260px' }}>
            <div className="panel-inset">
              <strong style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>Without prefix caching</strong>
              <p className="hint-text" style={{ marginTop: '4px' }}>
                On turn k, the inference server must re-prefill the entire accumulated history P<sub>k</sub>. Prefill latency increases linearly/quadratically per turn, causing high turn walltime.
              </p>
            </div>
            <div className="panel-inset">
              <strong style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>With prefix caching (RadixAttention)</strong>
              <p className="hint-text" style={{ marginTop: '4px' }}>
                The server reuses existing KV cache blocks for turns 1..k-1. It only prefills the new tool response tokens ΔP<sub>k</sub>, keeping turn walltimes consistently low.
              </p>
            </div>
          </div>
        </div>

        {/* Community FAQ — sourced from recurring questions on X */}
        <div className="panel-inset">
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
            Community FAQ — speed setups
          </h3>
          <p className="hint-text" style={{ marginBottom: '14px' }}>
            Compiled from the questions local-LLM users most often ask on X. Use the tabs above to reproduce each scenario.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              {
                q: 'Why is my first token so slow, then the rest are fast?',
                a: 'That is normal. The first token waits for the prefill phase: the whole prompt is processed at once (compute-bound). On a mid GPU that is hundreds of ms. After that, decode runs at one token per step, so it feels fast per token — but every token reads the full model weights from VRAM, which is why decode is bandwidth-bound.',
                demo: { tab: 'single', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, prompt: 8192, output: 256, sim: 5 }
              },
              {
                q: 'What is a good tok/s for a local model?',
                a: 'It depends on the model size and your memory bandwidth. Rule of thumb: decode speed ≈ usable VRAM bandwidth ÷ model size in bytes. A 24 GB/s-class card with a 4-bit 8B model does roughly 30-60 tok/s. If you are below ~10 tok/s on an 8B, something is off (CPU offload, no GPU layers, wrong build).',
                demo: { tab: 'compare', hwA: 'rtx3060_entry', hwB: 'rtx4090_exl2', cp: 4096, co: 512 }
              },
              {
                q: 'Why is decode so much slower than prefill?',
                a: 'Prefill is a big parallel matrix-matrix multiply (GEMM) — perfect for tensor cores. Decode is one matrix-vector multiply (GEMV) per token and is dominated by reading weights + KV cache from VRAM. You cannot fix decode speed with more compute; you need more memory bandwidth or a smaller/faster quantized model.',
                demo: { tab: 'single', preset: 'rtx3060_entry', prefill: 920, decode: 32, prompt: 4096, output: 2048, sim: 20 }
              },
              {
                q: 'How much VRAM do I need for model + context?',
                a: 'VRAM ≈ weights + KV cache + ~1-2 GB overhead. Weights: model bytes × quant size (e.g. 70B at Q4 ≈ 35-40 GB). KV cache: use the KV Cache Calculator tab — a dense 70B at 32k context FP16 is about 10 GB, so it often does not fit on 24 GB together with weights. Lower KV precision (FP8/INT4) or a shorter context is the lever.',
                demo: { tab: 'kvcache', model: 'llama70b', ctx: 32768, prec: 2 }
              },
              {
                q: 'Why does my context length run out of memory?',
                a: 'Because KV cache grows linearly with context and is allocated for every layer. Long prompts with agents (tool outputs, history) fill it fast. Solutions: quantize the KV cache (--cache-type-k/v q8_0 or q4_0), shorten the system prompt, enable prefix caching, or pick a model with MLA / linear attention (they need far less KV per token).',
                demo: { tab: 'kvcache', model: 'llama70b', ctx: 131072, prec: 2 }
              },
              {
                q: 'Does flash attention speed up prefill or decode?',
                a: 'Flash attention mainly accelerates prefill and long-context attention compute, and it reduces memory use. It has little effect on the decode bottleneck (bandwidth-bound GEMV). It can also free VRAM, which indirectly lets you use a bigger context. Benchmark both — the gain is model- and context-dependent.',
                demo: { tab: 'agentic', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, turns: 6, sprompt: 4096, tool: 1024, thought: 256, sim: 20 }
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
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 14px'
                }}
              >
                <summary style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                  {item.q}
                </summary>
                <p className="hint-text" style={{ marginTop: '8px' }}>
                  {item.a}
                </p>
                {item.demo && (
                  <button
                    onClick={() => { window.location.href = demoUrl(item.demo); }}
                    className="btn"
                    style={{ marginTop: '10px', minHeight: '30px', padding: '5px 12px', fontSize: '0.76rem' }}
                  >
                    <Play size={12} />
                    Try it in the visualizer
                  </button>
                )}
              </details>
            ))}
          </div>
        </div>

      </section>

    </div>
  );
}
