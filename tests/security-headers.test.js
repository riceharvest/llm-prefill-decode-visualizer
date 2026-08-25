import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// #640 — content-security hardening headers are declared in vercel.json:
// nosniff everywhere (API JSON + HTML challenge pages alike), a referrer
// policy, and an explicit frame-ancestors contract for /embed.

function headersBlock() {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  return { cfg, headers: cfg.headers || [] };
}

test('#640 vercel.json declares a global X-Content-Type-Options: nosniff', () => {
  const { headers } = headersBlock();
  const global = headers.filter(h => h.source === '/(.*)');
  const flat = global.flatMap(h => h.headers || []);
  const nosniff = flat.find(x => x.key === 'X-Content-Type-Options');
  assert.ok(nosniff, 'global header block must exist');
  assert.equal(nosniff.value, 'nosniff');
});

test('#640 Referrer-Policy is pinned globally', () => {
  const { headers } = headersBlock();
  const flat = headers.filter(h => h.source === '/(.*)').flatMap(h => h.headers || []);
  assert.equal(flat.find(x => x.key === 'Referrer-Policy')?.value, 'strict-origin-when-cross-origin');
});

test('#640 /embed declares an explicit frame-ancestors contract', () => {
  const { headers } = headersBlock();
  const embedSources = ['/embed', '/embed/'];
  for (const src of embedSources) {
    const entry = headers.find(h => h.source === src);
    assert.ok(entry, `header rule for ${src} must exist`);
    const csp = (entry.headers || []).find(x => x.key === 'Content-Security-Policy');
    assert.ok(csp, `${src} must carry a CSP`);
    assert.match(csp.value, /frame-ancestors \*/);
  }
});

test('#640 no frame-DENY anywhere (embedding /embed is the documented contract)', () => {
  const raw = readFileSync(join(ROOT, 'vercel.json'), 'utf8');
  assert.ok(!raw.includes('X-Frame-Options'), 'XFO DENY/SAMEORIGIN would break third-party embeds');
});
