// Issues #970 + #925 — matcher/host consistency:
//   - ?model= normalizes the same way on benchmarks/sizing/agent_benchmarks as
//     on best/localmaxxing (one needle, one vocabulary)
//   - sitemap/robots host binding is env-overridable, not pinned to production
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeQueryModel, normalizeModelId } from '../api/_normalize.js';
import { resolveSiteUrl, robotsSitemapLine } from '../scripts/generate-sitemap.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

test('normalizeQueryModel resolves display spellings that raw substring missed (#970 repro)', () => {
  assert.equal(normalizeQueryModel('Qwen3.6 27B'), 'qwen3-6-27b');
  assert.equal(normalizeQueryModel('deepseek v4 flash'), 'deepseek-v4-flash');
  // Already-canonical queries and broad substrings are unchanged.
  assert.equal(normalizeQueryModel('qwen3-6-27b'), 'qwen3-6-27b');
  assert.equal(normalizeQueryModel('qwen'), 'qwen');
});

test('normalized needle still matches whatever the raw lowercase needle matched (no regression)', () => {
  const samples = [
    ['Qwen/Qwen3.6-27B-GGUF', 'unsloth/Qwen3.6-27B-MTP-GGUF'],
    ['llama', 'Meta-Llama-3.1-8B-Instruct-GGUF'],
    ['gemma-4-12b', 'ggml-org/gemma-4-12B-it-GGUF'],
    ['27b-mtp', 'unsloth/Qwen3.6-27B-MTP-GGUF'],
    ['GGUF', 'any/Model-GGUF']
  ];
  for (const [query, modelId] of samples) {
    const family = normalizeModelId(modelId);
    const idLower = modelId.toLowerCase();
    const raw = query.toLowerCase();
    const norm = normalizeQueryModel(query);
    if (family.includes(raw) || idLower.includes(raw)) {
      assert.ok(
        family.includes(norm) || idLower.includes(norm),
        `normalized needle "${norm}" must keep matching where raw "${raw}" matched (${modelId})`
      );
    }
  }
});

test('benchmarks/sizing/agent_benchmarks use the shared normalizer (source contract)', () => {
  for (const f of ['_handlers/benchmarks.js', '_handlers/sizing.js', '_handlers/agent_benchmarks.js']) {
    const src = readFileSync(join(ROOT, 'api', f), 'utf8');
    assert.ok(src.includes("from '../_normalize.js'"), `${f} imports _normalize.js`);
    assert.ok(src.includes('normalizeQueryModel('), `${f} filters via normalizeQueryModel`);
    assert.doesNotMatch(src, /workload\.model\.toLowerCase\(\)/, `${f} no longer uses the raw lowercase needle`);
  }
});

test('robots Sitemap line derives from SITE_URL, not a hardcoded prod origin (#925)', () => {
  assert.equal(resolveSiteUrl({ SITE_URL: 'https://mirror.example.org/' }), 'https://mirror.example.org');
  assert.equal(resolveSiteUrl({}), 'https://llm-prefill-decode-visualizer.vercel.app');
  assert.equal(
    robotsSitemapLine('https://mirror.example.org'),
    'Sitemap: https://mirror.example.org/sitemap.xml'
  );
  // The committed robots.txt stays consistent with the default base.
  const robots = readFileSync(join(ROOT, 'public', 'robots.txt'), 'utf8');
  assert.match(robots, /^Sitemap: https:\/\/llm-prefill-decode-visualizer\.vercel\.app\/sitemap\.xml$/m);
});
