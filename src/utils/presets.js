import { fmtEn } from './numfmt.js';

export const HARDWARE_PRESETS = [
  {
    id: 'rtx4090_exl2',
    name: 'RTX 4090 24GB (ExLlamaV2 EXL2)',
    prefillSpeed: 3800,
    decodeSpeed: 105,
    icon: '⚡',
    badge: 'Localmaxxing #1 Consumer',
    vramBandwidth: '1.01 TB/s (GDDR6X)',
    // Machine-readable fit-math inputs (#483): total VRAM and card count as
    // numbers so agents don't have to NLP the name string.
    gpuModel: 'RTX 4090',
    gpuCount: 1,
    vramGbPerGpu: 24,
    vramGbTotal: 24,
    tdpWatts: 450,
    loadWatts: 450,
    psuWatts: 850,
    powerNote: 'Transient spikes exceed 600W — use a native ATX 3.x / 12V-2x6 PSU connection.',
    description: 'Top single consumer GPU on Localmaxxing running ExLlamaV2 with FlashAttention-2 & EXL2 4.0bpw.'
  },
  {
    id: 'dual_rtx3090',
    name: 'Dual RTX 3090 48GB (TP2 ExLlamaV2 70B)',
    prefillSpeed: 4600,
    decodeSpeed: 78,
    icon: '🖥️',
    badge: 'Localmaxxing 70B Rig',
    vramBandwidth: '1.87 TB/s Combined',
    gpuModel: 'RTX 3090',
    gpuCount: 2,
    vramGbPerGpu: 24,
    vramGbTotal: 48,
    tdpWatts: 350,
    loadWatts: 700,
    psuWatts: 1200,
    powerNote: 'Two cards: 4×8-pin PCIe connectors, and check the top card can breathe — dual axial coolers starve in most towers.',
    description: 'The go-to Localmaxxing dual 24GB rig running 70B parameter models in 4-bit with Tensor Parallelism.'
  },
  {
    id: 'rtx3090_llamacpp',
    name: 'RTX 3090 24GB (llama.cpp Q4_K_M)',
    prefillSpeed: 2400,
    decodeSpeed: 65,
    icon: '🔥',
    badge: 'Localmaxxing Budget King',
    vramBandwidth: '936 GB/s (GDDR6X)',
    gpuModel: 'RTX 3090',
    gpuCount: 1,
    vramGbPerGpu: 24,
    vramGbTotal: 24,
    tdpWatts: 350,
    loadWatts: 350,
    psuWatts: 850,
    powerNote: 'Power-limiting to ~280W costs ~5% token speed for ~20% less heat and fan noise.',
    description: 'Most popular community budget workstation GPU setup on Localmaxxing for 8B-32B models.'
  },
  {
    id: 'mac_ultra',
    name: 'Apple Mac Studio M3/M2 Ultra (192GB)',
    prefillSpeed: 1850,
    decodeSpeed: 38,
    icon: '🍏',
    badge: 'Localmaxxing High VRAM',
    vramBandwidth: '800 GB/s Unified',
    gpuModel: 'Apple M3/M2 Ultra',
    gpuCount: 1,
    vramGbPerGpu: 192,
    vramGbTotal: 192,
    tdpWatts: 140,
    loadWatts: 180,
    psuWatts: null,
    powerNote: 'Fixed internal supply — no PSU sizing needed; sustains full package power 24/7 within its acoustic envelope.',
    description: 'High-VRAM Apple Silicon workstation running large 70B-120B models completely in RAM.'
  },
  {
    id: 'rtx3060_entry',
    name: 'RTX 3060 12GB / RTX 4060 Ti (Ollama)',
    prefillSpeed: 920,
    decodeSpeed: 32,
    icon: '💻',
    badge: 'Localmaxxing Entry',
    vramBandwidth: '360 GB/s',
    // Name covers two cards (3060 12GB / 4060 Ti) — model left null, VRAM is
    // the conservative common floor.
    gpuModel: null,
    gpuCount: 1,
    vramGbPerGpu: 12,
    vramGbTotal: 12,
    tdpWatts: 170,
    loadWatts: 220,
    psuWatts: 550,
    powerNote: 'Single 8-pin connector — fits almost any existing build without a PSU upgrade.',
    description: 'Standard entry-level desktop GPU running 8B quantized models via Ollama / LM Studio.'
  },
  {
    id: 'groq',
    name: 'Groq LLaMA-3.3 70B (LPU Cluster)',
    prefillSpeed: 18000,
    decodeSpeed: 350,
    icon: '🚀',
    badge: 'Cloud LPU',
    vramBandwidth: 'Ultra (SRAM Direct)',
    // Cloud LPU cluster — card count/VRAM are the provider's business.
    gpuModel: 'Groq LPU',
    gpuCount: null,
    vramGbPerGpu: null,
    vramGbTotal: null,
    tdpWatts: null,
    loadWatts: null,
    psuWatts: null,
    powerNote: 'Hosted cloud — power and cooling are the provider\'s problem, not your electricity bill.',
    description: 'SRAM-based Language Processing Units delivering instantaneous prefill & lightning decoding.'
  },
  {
    id: 'h100',
    name: 'NVIDIA H100 SXM5 (vLLM FP8)',
    prefillSpeed: 9500,
    decodeSpeed: 130,
    icon: '🏢',
    badge: 'Enterprise Cloud',
    vramBandwidth: '3.35 TB/s (HBM3)',
    // Single reference card; managed cluster sizing is the provider's business.
    gpuModel: 'H100 SXM5',
    gpuCount: 1,
    vramGbPerGpu: 80,
    vramGbTotal: 80,
    tdpWatts: 700,
    loadWatts: 700,
    psuWatts: null,
    powerNote: 'Datacenter SXM5 module on a managed cluster — no desktop PSU applies.',
    description: 'Datacenter GPU cluster using PagedAttention and FP8 Tensor Cores.'
  },
  {
    id: 'rpi5',
    name: 'Raspberry Pi 5 (llama.cpp 4-bit)',
    prefillSpeed: 120,
    decodeSpeed: 8,
    icon: '🍓',
    badge: 'Edge CPU',
    vramBandwidth: '17 GB/s (LPDDR4X)',
    // CPU inference off the 8GB unified LPDDR4X board (no discrete GPU).
    gpuModel: null,
    gpuCount: null,
    vramGbPerGpu: 8,
    vramGbTotal: 8,
    tdpWatts: 12,
    loadWatts: 12,
    psuWatts: null,
    powerNote: 'Runs off the official 27W (5V/5A) USB-PD supply — active cooling recommended for long runs.',
    description: 'Edge ARM processor constrained by CPU memory bandwidth during decode.'
  },
  {
    id: 'custom',
    name: 'Custom Hardware Profile',
    prefillSpeed: 2500,
    decodeSpeed: 50,
    icon: '⚙️',
    badge: 'User Defined',
    vramBandwidth: 'User Configurable',
    // User-defined — nothing machine-readable to expose.
    gpuModel: null,
    gpuCount: null,
    vramGbPerGpu: null,
    vramGbTotal: null,
    tdpWatts: null,
    loadWatts: null,
    psuWatts: null,
    powerNote: null,
    description: 'Set custom prefill and decode speeds for your own server benchmark.'
  }
];

// Workload scenario presets: common prompt/output shapes for quick demos.
export const SCENARIO_PRESETS = [
  { id: 'chat', label: 'Standard chat', icon: '💬', promptTokens: 2048, outputTokens: 512 },
  { id: 'rag', label: 'RAG query', icon: '📚', promptTokens: 4096, outputTokens: 512 },
  { id: 'longdoc', label: 'Summarize doc', icon: '📄', promptTokens: 32768, outputTokens: 256 },
  { id: 'codegen', label: 'Code generation', icon: '💻', promptTokens: 2048, outputTokens: 4096 },
  { id: 'reasoning', label: 'Deep reasoning', icon: '🧠', promptTokens: 1024, outputTokens: 2048 }
];

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '∞';
  if (seconds < 0.001) return `${(seconds * 1000000).toFixed(0)} µs`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(1)} ms`;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}m ${secs}s`;
}

export function formatTokens(num) {
  if (!Number.isFinite(num)) return '∞';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 10000) return `${(num / 1000).toFixed(1)}k`;
  // Below 10k show the exact number with thousands separators — "4,096" is
  // clearer than "4.1k" for benchmark values people recognize.
  return fmtEn(num);
}
