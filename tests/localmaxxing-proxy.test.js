// Issue #627: vercel.json used to rewrite /localmaxxing-api/:path* — ALL
// paths, all methods, all query strings — to https://www.localmaxxing.com,
// an unauthenticated open proxy. The app only ever calls /leaderboard and
// /models through that prefix (see src/utils/localMaxxing.js +
// src/utils/hardwareFirst.js), so the rewrite is narrowed to exactly those
// two paths. This test pins the contract so the wildcard can't creep back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

function clientSources() {
  // Collect every literal '/localmaxxing-api/<path>' usage in src/.
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(js|jsx)$/.test(entry.name)) {
        const hits = readFileSync(p, 'utf8').match(/\/localmaxxing-api\/([a-z?=&\-${}]+)/g) || [];
        out.push(...hits);
      }
    }
  };
  walk(join(root, 'src'));
  return out;
}

test('no wildcard proxy rewrite to the third-party origin remains', () => {
  for (const r of vercel.rewrites || []) {
    if (String(r.destination).includes('localmaxxing.com')) {
      assert.ok(!String(r.source).includes(':path*'), `wildcard proxy still present: ${r.source}`);
    }
  }
});

test('the only proxied localmaxxing paths are leaderboard and models', () => {
  const proxied = (vercel.rewrites || [])
    .filter(r => String(r.destination).includes('localmaxxing.com'))
    .map(r => ({ source: r.source, destination: r.destination }));
  assert.equal(proxied.length, 2);
  for (const p of proxied) {
    const sub = p.source.replace('/localmaxxing-api/', '');
    assert.equal(p.destination, `https://www.localmaxxing.com/api/${sub}`);
  }
  assert.deepEqual(proxied.map(p => p.source).sort(), [
    '/localmaxxing-api/leaderboard',
    '/localmaxxing-api/models'
  ]);
});

test('every client call to /localmaxxing-api/* is covered by a narrow rewrite', () => {
  const usages = [...new Set(clientSources().map(u => u.split('?')[0]))];
  assert.ok(usages.length > 0, 'expected at least one client usage of the proxy prefix');
  const allowed = new Set(['/localmaxxing-api/leaderboard', '/localmaxxing-api/models']);
  for (const u of usages) {
    assert.ok(allowed.has(u), `client uses unproxied path ${u}`);
  }
});
