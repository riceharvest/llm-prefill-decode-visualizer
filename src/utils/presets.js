export const HARDWARE_PRESETS = [
  {
    id: 'groq',
    name: 'Groq LLaMA-3.3 70B (LPU)',
    prefillSpeed: 18000,
    decodeSpeed: 350,
    icon: '⚡',
    badge: 'Ultra Fast LPU',
    vramBandwidth: 'Ultra (SRAM Direct)',
    description: 'SRAM-based Language Processing Units delivering instantaneous prefill & lightning decoding.'
  },
  {
    id: 'h100',
    name: 'NVIDIA H100 (vLLM FP8)',
    prefillSpeed: 9500,
    decodeSpeed: 130,
    icon: '🏢',
    badge: 'Enterprise Cloud',
    vramBandwidth: '3.35 TB/s (HBM3)',
    description: 'Datacenter GPU cluster using PagedAttention and FP8 Tensor Cores.'
  },
  {
    id: 'rtx4090',
    name: 'NVIDIA RTX 4090 (SGLang)',
    prefillSpeed: 3500,
    decodeSpeed: 85,
    icon: '🖥️',
    badge: 'Workstation GPU',
    vramBandwidth: '1.01 TB/s (GDDR6X)',
    description: 'High-end desktop GPU running optimized SGLang or vLLM engines.'
  },
  {
    id: 'm3max',
    name: 'Apple Mac M3 Max (Metal/MLX)',
    prefillSpeed: 1500,
    decodeSpeed: 42,
    icon: '💻',
    badge: 'Unified Memory',
    vramBandwidth: '400 GB/s',
    description: 'Apple Silicon with high bandwidth unified memory running 4-bit/8-bit models.'
  },
  {
    id: 'rpi5',
    name: 'Raspberry Pi 5 (llama.cpp)',
    prefillSpeed: 120,
    decodeSpeed: 8,
    icon: '🍓',
    badge: 'Edge CPU',
    vramBandwidth: '17 GB/s (LPDDR4X)',
    description: 'Edge ARM processor constrained by memory bandwidth during decode.'
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
