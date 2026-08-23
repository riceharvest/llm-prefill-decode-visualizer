// Generates public/llms-full.txt — a single-file compilation of ALL agent
// documentation, served at the site root as /llms-full.txt (issue #316 stack).
//
// Sources are concatenated verbatim, in reading order:
//   1. llms.txt            — the machine-readable capability index
//   2. README.md           — features, setup and architecture overview
//   3. public/llms.txt     — the full API guide served at /llms.txt
//   4. CHANGELOG-API.md    — schema-versioning policy and endpoint history
//   5. mcp/README.md       — MCP server usage
//
// Each source is preceded by an HTML comment naming its origin file so
// consumers can attribute sections. `npm run build` regenerates the file, and
// llms-full-txt.test.js asserts the committed copy is fresh (matches a
// regeneration) so docs can't silently drift out of the compilation.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'public', 'llms-full.txt');

const SOURCES = [
  'llms.txt',
  'README.md',
  'public/llms.txt',
  'CHANGELOG-API.md',
  'mcp/README.md',
];

const parts = [
  '# LLM Prefill & Decode Speed Visualizer — Full Documentation',
  '',
  '> Single-file compilation of every agent-facing document in this repository:',
  '> the llms.txt capability index, README, full API guide (/llms.txt), API',
  '> changelog and MCP server docs, concatenated in one flat markdown file.',
  '> Individual sources are marked with `<!-- source: <path> -->` comments.',
  '',
];

for (const src of SOURCES) {
  const body = readFileSync(join(root, src), 'utf8').trimEnd();
  parts.push(`<!-- source: ${src} -->`, '', body, '', '---', '');
}

writeFileSync(OUT, parts.join('\n'), 'utf8');
console.log(
  `[llms-full] wrote ${OUT} (${parts.join('\n').length} bytes) from ${SOURCES.length} sources`,
);
