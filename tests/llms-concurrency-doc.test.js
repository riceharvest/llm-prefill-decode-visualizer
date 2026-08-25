// Rate-limit x HTTP/2 concurrency guidance in the agent docs (#1110).
//
// The h2 SETTINGS frame advertises MAX_CONCURRENT_STREAMS=160 (wire-only,
// undiscoverable) while llms.txt documents a 120 req/min per-IP budget. A
// full-width burst sized from the transport alone is guaranteed to hit 429
// mid-window. Pins that the docs reconcile the two numbers and give the
// sizing rule, so the guidance can't silently disappear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const llms = readFileSync(join(root, 'public', 'llms.txt'), 'utf8');

test('llms.txt rate-limit section reconciles h2 stream capacity with the req/min budget (#1110)', () => {
  const section = llms.split(/^### /m).find(s => s.startsWith('Rate limits'));
  assert.ok(section, 'Rate limits section exists');
  assert.match(section, /MAX_CONCURRENT_STREAMS/, 'names the h2 SETTINGS field');
  assert.match(section, /\b160\b/, 'carries the advertised stream count');
  assert.match(section, /120 requests\/min|120 req\/min/, 'cross-references the app budget');
  assert.match(section, /X-RateLimit-Remaining/, 'gives the sizing rule: fan-out from remaining budget');
});

test('the guidance is compiled into llms-full.txt too (#1110)', () => {
  const full = readFileSync(join(root, 'public', 'llms-full.txt'), 'utf8');
  assert.match(full, /MAX_CONCURRENT_STREAMS/);
});
