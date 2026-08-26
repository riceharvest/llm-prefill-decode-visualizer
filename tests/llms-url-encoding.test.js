// #470 — every example URL in the served llms.txt must be executable
// verbatim: a literal space makes HTTP clients reject the URL before any
// request is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');

for (const file of ['public/llms.txt', 'public/llms-full.txt']) {
  const text = readFileSync(join(root, file), 'utf8');

  test(`${file}: localmaxxing hardware example is percent-encoded (#470)`, () => {
    assert.match(text, /\?hardware=rtx%203090&limit=50/);
    assert.ok(!text.includes('?hardware=rtx 3090'), 'raw-space example URL is back');
  });

  test(`${file}: no backtick-quoted query example contains a raw space`, () => {
    // Query examples are quoted like `?a=b&c=d`; spaces inside a URL string
    // break curl/wget/requests. Prose sentences with spaces aren't quoted.
    const examples = [...text.matchAll(/`(\?[^\s`]* [^`]*)`/g)].map(m => m[1]);
    assert.deepEqual(examples, [], `query examples containing literal spaces: ${examples.join(' | ')}`);
  });
}
