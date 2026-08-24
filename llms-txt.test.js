import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const content = readFileSync(resolve(root, 'llms.txt'), 'utf8');
const lines = content.split('\n');

test('llms.txt starts with an H1 title', () => {
  assert.match(lines[0], /^# \S/, 'first line must be an `# ` H1 heading');
});

test('llms.txt has a blockquote summary right after the H1', () => {
  const afterH1 = lines.slice(1).find((l) => l.trim() !== '');
  assert.ok(afterH1.startsWith('> '), 'first non-blank line after H1 must be a `> ` blockquote');
});

test('llms.txt has at least two H2 sections with no duplicates', () => {
  const h2s = lines.filter((l) => l.startsWith('## '));
  assert.ok(h2s.length >= 2, `expected >= 2 H2 sections, found ${h2s.length}`);
  const dupes = h2s.filter((h, i) => h2s.indexOf(h) !== i);
  assert.deepEqual(dupes, [], `duplicate H2 headings: ${dupes.join(', ')}`);
});

test('every relative link target in llms.txt exists in the repo', () => {
  const links = [...content.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)];
  assert.ok(links.length >= 8, `expected >= 8 links, found ${links.length}`);
  for (const [, text, target] of links) {
    assert.ok(text.trim().length > 0, 'link text must not be empty');
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const path = isAbsolute(target) ? target : resolve(root, target);
    assert.ok(existsSync(path), `linked path does not exist: ${target}`);
    assert.ok(
      statSync(path).isFile() || statSync(path).isDirectory(),
      `linked path is neither a file nor a directory: ${target}`,
    );
  }
});

// --- The SERVED artifact (public/llms.txt) must pass the same structural
// --- conformance rules (#1100): CI used to certify only the repo-root file,
// --- which is never deployed.
const servedPath = resolve(root, 'public', 'llms.txt');
const served = readFileSync(servedPath, 'utf8');
const servedLines = served.split('\n');

// Link targets inside the deployed file are URL paths: `/x` resolves under
// public/ (the static deploy root); other relative targets resolve against
// the repo root; absolute http(s)/#/mailto targets are not checked on disk.
function resolveServedTarget(target) {
  if (/^(https?:|#|mailto:)/.test(target)) return null;
  return resolve(root, 'public', target.replace(/^\//, ''));
}

test('served public/llms.txt starts with an H1 title', () => {
  assert.match(servedLines[0], /^# \S/, 'first line must be an `# ` H1 heading');
});

test('served public/llms.txt has a blockquote summary right after the H1', () => {
  const afterH1 = servedLines.slice(1).find((l) => l.trim() !== '');
  assert.ok(afterH1.startsWith('> '), 'first non-blank line after H1 must be a `> ` blockquote');
});

test('served public/llms.txt has at least two H2 sections with no duplicates', () => {
  const h2s = servedLines.filter((l) => l.startsWith('## '));
  assert.ok(h2s.length >= 2, `expected >= 2 H2 sections, found ${h2s.length}`);
  const dupes = h2s.filter((h, i) => h2s.indexOf(h) !== i);
  assert.deepEqual(dupes, [], `duplicate H2 headings: ${dupes.join(', ')}`);
});

test('served public/llms.txt has at least 8 links and every relative target resolves under public/', () => {
  const links = [...served.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)];
  assert.ok(links.length >= 8, `expected >= 8 links, found ${links.length}`);
  for (const [, text, target] of links) {
    assert.ok(text.trim().length > 0, 'link text must not be empty');
    const path = resolveServedTarget(target);
    if (path === null) continue;
    assert.ok(existsSync(path), `linked path does not exist under public/: ${target}`);
  }
});

test('served public/llms.txt links the core machine-readable discovery surfaces', () => {
  // Closes #888's mention gap mechanically: a link-following llms.txt parser
  // must be able to reach the API surface from the deployed document alone.
  for (const surface of [
    '/api/spec',
    '/agents.json',
    '/api/agent/index.json',
    '/.well-known/mcp.json',
    '/changelog.json',
    '/llms-full.txt',
  ]) {
    assert.ok(served.includes(surface), `deployed llms.txt must reference ${surface}`);
  }
});

test('served public/llms.txt documents the h2 connection-lifetime contract (#1109)', () => {
  // PING/GOAWAY/SETTINGS policy must exist in a deployed discovery surface.
  assert.match(served, /PING/i, 'must tell agents the edge PINGs idle h2 connections');
  assert.match(served, /GOAWAY/i, 'must state the observed GOAWAY behavior/policy');
  assert.match(served, /MAX_CONCURRENT_STREAMS=\d+/i, 'must surface the wire SETTINGS limits');
});
