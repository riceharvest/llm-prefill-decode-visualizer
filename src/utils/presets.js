export const HARDWARE_PRESETS = [
  {
    id: 'rtx4090_exl2',
    name: 'RTX 4090 24GB (ExLlamaV2 EXL2)',
    prefillSpeed: 3800,
    decodeSpeed: 105,
    icon: '⚡',
    badge: 'Localmaxxing #1 Consumer',
    vramBandwidth: '1.01 TB/s (GDDR6X)',
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
    description: 'Set custom prefill and decode speeds for your own server benchmark.'
  }
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
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toLocaleString();
}
