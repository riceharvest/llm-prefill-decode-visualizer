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
//
// Link rewriting (issue #888): the sources are written for GitHub readers, so
// their markdown links point at repo-relative paths (`public/agents.json`,
// `mcp/README.md`, …). On the hosted site those resolve against the site root
// and 404. Before concatenation this script rewrites links whose target is a
// file that IS deployed at the site root to its deployment URL, and unwraps
// every other repo-relative link to plain `` `path` `` text so the compiled
// document never advertises an unresolvable URL.
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

/** Repo-relative paths that are also served at the site root when deployed. */
const DEPLOYED_AT_ROOT = {
  'public/llms.txt': '/llms.txt',
  'public/llms-full.txt': '/llms-full.txt',
  'public/agents.json': '/agents.json',
  'public/api/agent/index.json': '/api/agent/index.json',
  'public/changelog.json': '/changelog.json',
  'public/status.html': '/status.html',
  'compare.html': '/compare.html',
};

/**
 * Rewrite one markdown link.
 * - absolute/http/mailto/fragment targets pass through untouched;
 * - targets deployed at the site root become root-relative deployed URLs;
 * - every other relative target is unwrapped to `text (`target`)` code text.
 */
export function rewriteMarkdownLink(text, target) {
  if (/^(https?:|#|mailto:)/i.test(target)) return `[${text}](${target})`;
  if (target.startsWith('/')) return `[${text}](${target})`; // already a deployment-root URL
  const deployed = DEPLOYED_AT_ROOT[target.replace(/^\.\//, '')];
  if (deployed) return `[${text}](${deployed})`;
  return `${text} (\`${target}\`)`;
}

/** Apply rewriteMarkdownLink to every markdown link in a source body. */
export function rewriteRelativeLinks(body) {
  return body.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, target) =>
    rewriteMarkdownLink(text, target),
  );
}

const parts = [
  '# LLM Prefill & Decode Speed Visualizer — Full Documentation',
  '',
  '> Single-file compilation of every agent-facing document in this repository:',
  '> the llms.txt capability index, README, full API guide (/llms.txt), API',
  '> changelog and MCP server docs, concatenated in one flat markdown file.',
  '> Individual sources are marked with `<!-- source: <path> -->` comments.',
  '> Links to files served at the site root point at their deployed URLs;',
  '> links to repository-only files are shown as plain `repo/path` text.',
  '',
];

for (const src of SOURCES) {
  const body = rewriteRelativeLinks(readFileSync(join(root, src), 'utf8').trimEnd());
  parts.push(`<!-- source: ${src} -->`, '', body, '', '---', '');
}

writeFileSync(OUT, parts.join('\n'), 'utf8');
console.log(
  `[llms-full] wrote ${OUT} (${parts.join('\n').length} bytes) from ${SOURCES.length} sources`,
);
