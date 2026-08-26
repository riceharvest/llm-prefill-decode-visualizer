import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SOURCES, THEORY_SOURCES } from './scripts/generate-llms-full.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fullPath = join(root, 'public', 'llms-full.txt');
const content = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';

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

test('llms-full.txt has no dead repo-relative links — every link resolves on the deployed site (#888)', () => {
  // Sources are written for GitHub readers; the compilation is served at the
  // site root where repo-relative hrefs 404. The generator rewrites deployed
  // artifacts to root URLs and unwraps everything else to `repo/path` text.
  const DEAD = [];
  for (const [, target] of content.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|#|mailto:)/i.test(target)) continue;
    if (/^\//.test(target)) continue; // deployment-root URLs are fine
    DEAD.push(target);
  }
  assert.deepEqual(
    DEAD,
    [],
    `llms-full.txt still links repo-relative paths that 404 on the hosted site: ${DEAD.join(', ')}`,
  );
});

test('Theory tab content (explainer + FAQ + glossary) is compiled in (#530)', () => {
  assert.ok(
    content.includes('# Theory tab content'),
    'generated theory section missing from llms-full.txt',
  );
  const theory = JSON.parse(readFileSync(join(root, 'src/i18n/locales/en/theory.json'), 'utf8'));
  const plain = JSON.parse(readFileSync(join(root, 'src/i18n/locales/en/plainLanguage.json'), 'utf8'));
  // Every FAQ question (the misconception callouts) must be present.
  for (const item of theory.faq) {
    assert.ok(content.includes(item.q), `FAQ question missing: ${item.q}`);
    assert.ok(content.includes(item.a), 'FAQ answer missing');
  }
  // Glossary terms (short → plain → long) must be present.
  for (const term of Object.values(plain.terms)) {
    assert.ok(content.includes(term.short) && content.includes(term.long), `glossary term missing: ${term.short}`);
  }
});

test('committed llms-full.txt is fresh — regenerating reproduces it byte-for-byte', () => {
  // Build a minimal scratch tree (generator + its inputs) so the real file is
  // only compared, never rewritten mid-test, and no node_modules copy is made.
  const scratchSources = ['scripts/generate-llms-full.mjs', ...SOURCES, ...THEORY_SOURCES];
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
