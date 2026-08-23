import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';


const root = dirname(fileURLToPath(import.meta.url));
const fullPath = join(root, 'public', 'llms-full.txt');
const content = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';

const SOURCES = ['llms.txt', 'README.md', 'public/llms.txt', 'CHANGELOG-API.md', 'mcp/README.md'];

test('llms-full.txt exists in public/ (served at the site root as /llms-full.txt)', () => {
  assert.ok(existsSync(fullPath), 'public/llms-full.txt must exist so vite build ships it');
  assert.ok(statSync(fullPath).isFile(), 'public/llms-full.txt must be a regular file');
});

test('llms-full.txt is non-trivially sized — larger than any single source doc', () => {
  const size = statSync(fullPath).size;
  assert.ok(size >= 20_000, `expected >= 20000 bytes, got ${size}`);
  for (const src of SOURCES) {
    const srcSize = statSync(join(root, src)).size;
    assert.ok(size > srcSize, `compilation (${size}B) must be larger than ${src} (${srcSize}B)`);
  }
});

test('llms-full.txt contains key section headers from every source doc', () => {
  // One or more representative headers per compiled source.
  const expected = [
    '# LLM Prefill & Decode Speed Visualizer', // llms.txt / README.md
    '## Docs', // root llms.txt index
    '## 🌟 Key Features', // README.md
    '## For AI agents — read this first', // public/llms.txt (full API guide)
    '## Endpoint reference', // public/llms.txt
    '# API Changelog & Deprecation Policy', // CHANGELOG-API.md
    '## Versioning policy', // CHANGELOG-API.md
    '# llm-prefill-decode-visualizer MCP server', // mcp/README.md
    '## Register with an MCP client', // mcp/README.md
  ];
  for (const header of expected) {
    assert.ok(content.includes(header), `missing section header: ${header}`);
  }
});

test('every source doc is attributed with a source comment', () => {
  for (const src of SOURCES) {
    assert.ok(
      content.includes(`<!-- source: ${src} -->`),
      `missing attribution comment for ${src}`,
    );
  }
});

test('committed llms-full.txt is fresh — regenerating reproduces it byte-for-byte', () => {
  // Build a minimal scratch tree (generator + its inputs) so the real file is
  // only compared, never rewritten mid-test, and no node_modules copy is made.
  const scratchSources = ['scripts/generate-llms-full.mjs', ...SOURCES];
  for (const src of scratchSources) {
    const dest = join(tmpdir(), 'llms-full-scratch', src);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(root, src)));
  }
  const before = readFileSync(fullPath);
  try {
    execFileSync(process.execPath, [join('scripts', 'generate-llms-full.mjs')], {
      cwd: join(tmpdir(), 'llms-full-scratch'),
      stdio: 'pipe',
    });
    const regenerated = readFileSync(
      join(tmpdir(), 'llms-full-scratch', 'public', 'llms-full.txt'),
    );
    assert.ok(
      before.equals(regenerated),
      'public/llms-full.txt is stale; run: node scripts/generate-llms-full.mjs',
    );
  } finally {
    execFileSync('rm', ['-rf', join(tmpdir(), 'llms-full-scratch')], { stdio: 'pipe' });
  }
});
