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

test('llms.txt reveals the machine-readable endpoint indexes (#888)', () => {
  // The primary prose doc must point agents at the two complete indexes —
  // /api/spec alone omits live endpoints.
  assert.match(content, /\/agents\.json/, 'llms.txt must mention the agent manifest');
  assert.match(content, /\/api\/agent\/index\.json/, 'llms.txt must mention the endpoint index');
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
