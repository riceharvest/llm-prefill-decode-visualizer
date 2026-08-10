# LLM Prefill & Decode Speed Visualizer

An interactive, high-performance web application and benchmark tool designed to visualize, measure, and analyze **LLM (Large Language Model) Prefill** and **Decode** speeds for single-turn chat and multi-turn agentic workflows.

![Material White Theme](https://img.shields.io/badge/Theme-Material%20White-6366F1)
![License](https://img.shields.io/badge/License-MIT-blue)
![React](https://img.shields.io/badge/React-19-059669)
![Vite](https://img.shields.io/badge/Vite-6-2563EB)

---

## 🌟 Key Features

1. **Material White Design System**:
   - Clean, elevated light UI with Material Design 3 tokens, smooth progress animations, and responsive metrics breakdown.

2. **Independent Prefill & Decode Speed Controls**:
   - User-configurable **Prefill Speed** (`tokens/sec`) for prompt ingestion.
   - User-configurable **Decode Speed** (`tokens/sec`) for autoregressive generation.
   - Visual time-scale multiplier (`1x`, `2x`, `5x`, `20x`, `Instant`) for real-time streaming or fast simulation of huge context windows.

3. **💬 Single-Turn Chat Mode**:
   - Measure **Time-To-First-Token (TTFT)**, **Time-Per-Output-Token (TPOT)**, and total walltime.
   - Animated prefill context matrix & live autoregressive decode token streaming window.
   - Walltime percentage distribution bar (Prefill % vs Decode %).

4. **🤖 Agentic Multi-Turn Loop Mode**:
   - Simulates multi-turn autonomous agent loops (Plan → Tool Call → Tool Result → Next Action).
   - Measures **per-turn walltime** as prompt history expands.
   - **Prefix Caching (KV Cache Reuse)** Toggle: Compare walltime savings of prefix caching vs full history re-prefill across turns.
   - Interactive turn-by-turn Gantt / Waterfall walltime chart.

5. **⚖️ Side-by-Side Hardware Comparison**:
   - Compare benchmark metrics across 2 hardware profiles (e.g. Groq LPU vs NVIDIA H100 vs RTX 4090 vs Apple Silicon M3 Max vs Raspberry Pi 5).

6. **🧠 Interactive KV Cache VRAM Calculator**:
   - Estimate GPU memory footprint for Key-Value caches based on model layers, hidden dimension, GQA heads, sequence length, and data precision (FP16 / FP8 / INT4).

7. **📖 Theory & Engineering Guide**:
   - Detailed breakdown of **Compute-Bound (FLOPs bound)** prefill matrix multiplications ($GEMM$) vs. **Memory Bandwidth-Bound** decode vector multiplications ($GEMV$).

---

## 🚀 Quick Start

### Prerequisites
- Node.js `v18+`
- npm `v9+`

### Installation & Running Locally

```bash
# Clone the repository
git clone https://github.com/riceharvest/llm-prefill-decode-visualizer.git
cd llm-prefill-decode-visualizer

# Install dependencies
npm install

# Start development server
npm run dev
```

Open your browser at `http://localhost:5173`.

### Production Build

```bash
npm run build
```

---

## 📐 Mathematical Equations

### Time-To-First-Token (TTFT)
$$\text{TTFT} = \frac{\text{Prompt Tokens}}{\text{Prefill Speed (tok/s)}}$$

### Time-Per-Output-Token (TPOT)
$$\text{TPOT} = \frac{1000}{\text{Decode Speed (tok/s)}} \quad (\text{ms/token})$$

### Single-Turn Total Walltime
$$\text{Walltime}_{\text{Chat}} = \text{TTFT} + \frac{\text{Output Tokens}}{\text{Decode Speed}}$$

### Agentic Loop Turn $k$ Walltime (With Prefix Caching)
$$\text{Walltime}_{\text{Turn } k} = \frac{\Delta \text{Prompt Tokens}_k}{\text{Prefill Speed}} + \frac{\text{Decode Tokens}_k}{\text{Decode Speed}}$$

---

## 📄 License
MIT License. Created for AI researchers, inference engineers, and LLM developers.
