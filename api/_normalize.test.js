import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelId } from './_normalize.js';

test('collapses repo/quant/finetune variants to one family', () => {
  assert.equal(normalizeModelId('unsloth/Qwen3.6-27B-MTP-GGUF'), 'qwen3-6-27b');
  assert.equal(normalizeModelId('mlx-community/Qwen3.6-27B-4bit'), 'qwen3-6-27b');
  assert.equal(normalizeModelId('Qwen/Qwen3.6-27B'), 'qwen3-6-27b');
  assert.equal(normalizeModelId('AEON-7/Qwen3.6-27B-AEON-Ultimate-Uncensored-NVFP4'), 'qwen3-6-27b');
});

test('preserves MoE active-parameter tags', () => {
  assert.equal(normalizeModelId('mlx-community/Qwen3.6-35B-A3B-4bit'), 'qwen3-6-35b-a3b');
  assert.equal(normalizeModelId('LiquidAI/LFM2.5-8B-A1B-GGUF'), 'lfm2-5-8b-a1b');
  assert.equal(normalizeModelId('JetBrains/Mellum2-12B-A2.5B-Instruct'), 'mellum2-12b-a2.5b');
  // e4b/e2b variants (gemma) are distinct model sizes, not quant tags — keep them
  assert.equal(normalizeModelId('lmstudio-community/gemma-4-E4B-it-GGUF'), 'gemma-4-e4b');
  assert.equal(normalizeModelId('google/gemma-4-27B-it-GGUF'), 'gemma-4-27b');
});

test('handles multi-token family names and small sizes', () => {
  assert.equal(normalizeModelId('ggml-org/gemma-4-12B-it-GGUF'), 'gemma-4-12b');
  assert.equal(normalizeModelId('lmstudio-community/NVIDIA-Nemotron-3-Nano-4B-GGUF'), 'nvidia-nemotron-3-nano-4b');
  assert.equal(normalizeModelId('bartowski/Llama-3.1-8B-Instruct-i1-GGUF'), 'llama-3-1-8b');
  assert.equal(normalizeModelId('HuggingFaceTB/SmolLM2-135M-Instruct'), 'smollm2-135m');
  assert.equal(normalizeModelId('facebook/MobileLLM-350M'), 'mobilellm-350m');
});
