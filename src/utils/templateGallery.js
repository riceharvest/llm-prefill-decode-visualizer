// Template gallery (issue #111) — one-click scenario cards that answer the
// questions newcomers actually ask. Each template pairs a fully-configured
// simulation (URL params passed through demoUrl(), same format as the
// FAQ_DEMOS deep-links in TheoryGuide.jsx) with a short theory blurb, so a
// curious visitor can go from question to a running, pre-configured sim in
// one click.
//
// Data lives here (not in i18n strings) following the SCENARIO_PRESETS
// pattern in presets.js: plain exported arrays consumed by the UI.

export const TEMPLATE_GALLERY = [
  {
    id: 'agent-slow-turn5',
    question: 'Why is my agent slow after turn 5?',
    icon: '🤖',
    tagline: 'Un-cached agent loops re-prefill the whole conversation every turn',
    blurb:
      'Every turn an agent appends tool output and its own reply to the transcript. Without prefix caching, the server re-prefills the ENTIRE conversation on every turn, so turn cost grows linearly with turn count — turn 8 re-ingests everything turns 1-7 produced. This demo runs an 8-turn loop with caching OFF so you can watch per-turn prefill bars stack up; toggle "prefix caching" in the controls and the later turns collapse to just the new tokens.',
    demo: {
      tab: 'agentic', preset: 'rtx4090_exl2', prefill: 3800, decode: 105,
      turns: 8, sprompt: 4096, tool: 1024, thought: 256, cache: 0, sim: 20
    },
    chips: ['Agentic tab', '8 turns', 'caching off']
  },
  {
    id: 'prefix-caching-128k',
    question: 'Does prefix caching help at 128K context?',
    icon: '📚',
    tagline: 'Yes — and the bigger the shared prefix, the bigger the win',
    blurb:
      'Prefix caching skips re-prefilling tokens the server has already ingested for an identical prompt prefix. The win scales with the SHARED portion, not the total: at a 64K-token shared system + document prefix, every turn saves a 64K-token prefill — roughly 17 s of TTFT on an RTX 4090 (65,536 ÷ 3,800 tok/s) — and pays only for the fresh tool output. Run the demo and compare turn 1 (full prefill) with turn 2+ (delta only).',
    demo: {
      tab: 'agentic', preset: 'rtx4090_exl2', prefill: 3800, decode: 105,
      turns: 4, sprompt: 65536, tool: 4096, thought: 512, cache: 1, sim: 50
    },
    chips: ['Agentic tab', '64K shared prefix', 'caching on']
  },
  {
    id: 'rpi5-7b',
    question: 'Can a Raspberry Pi 5 run a 7B?',
    icon: '🍓',
    tagline: 'It can run it — slowly, because decode is bandwidth-bound',
    blurb:
      'A Pi 5 has no GPU; a 4-bit 7B fits in its 8 GB RAM but every decoded token must stream all ~4 GB of weights from LPDDR4X at ~17 GB/s. That caps decode around 8 tok/s no matter how good the software is — decode is memory-bandwidth-bound, and the Pi has very little. Prefill is even worse (~120 tok/s). The sim shows the honest numbers: first token in ~17 s, then a token every ~125 ms.',
    demo: {
      tab: 'single', preset: 'rpi5', prefill: 120, decode: 8,
      prompt: 2048, output: 256, sim: 'instant'
    },
    chips: ['Single turn tab', 'Raspberry Pi 5', '7B-class 4-bit']
  },
  {
    id: 'fp16-vs-int4-kv',
    question: 'FP16 vs INT4 KV cache VRAM',
    icon: '💾',
    tagline: 'Halving KV bytes doubles the context that fits — weights too',
    blurb:
      'KV cache size is bytes-per-token × context × batch, and the bytes-per-token scales directly with KV precision. For a 70B model at 128K context, FP16 KV needs ~40 GB while INT4 KV needs ~10 GB — the difference between "needs an H100" and "fits on two 24 GB cards". The catch: INT4 KV quantization is lossy for long-range attention recall. Load the demo, then flip the precision toggle to INT4 and watch the memory bar shrink 4×.',
    demo: {
      tab: 'kvcache', model: 'llama70b', ctx: 131072, prec: 2, batch: 1
    },
    chips: ['KV cache tab', '70B @ 128K', 'FP16 baseline']
  }
];

export function templateById(id) {
  return TEMPLATE_GALLERY.find(t => t.id === id) || null;
}
