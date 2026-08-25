// Issues #915 + #909 — machine-readable trust + crawl-signal consistency:
//   - RFC 9116 /.well-known/security.txt exists, well-formed, extensionless
//     probe rewritten by vercel.json
//   - contact.html JSON-LD no longer routes security reports to public issues
//   - status.html no longer ships meta robots noindex while four discovery
//     surfaces advertise it as the status page
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const securityTxt = () => readFileSync(join(ROOT, 'public', '.well-known', 'security.txt'), 'utf8');

test('security.txt carries the required RFC 9116 fields with valid values', () => {
  const txt = securityTxt();
  const lines = txt.split('\n').filter(l => l && !l.startsWith('#'));
  const fields = {};
  for (const line of lines) {
    const m = line.match(/^([A-Za-z]+):\s*(.+)$/);
    assert.ok(m, `malformed field line: ${line}`);
    fields[m[1]] = m[2];
  }
  // Contact is the only MUST field; one private-advisory channel, never the public tracker.
  assert.ok(fields.Contact, 'Contact is required');
  assert.ok(Array.isArray(fields.Contact) === false);
  assert.match(fields.Contact, /\/security\/advisories/, 'Contact must be the private advisory path');
  assert.doesNotMatch(fields.Contact, /\/issues$/, 'Contact must NOT point at the public issue tracker');
  assert.ok(fields.Expires, 'Expires recommended');
  assert.match(fields.Expires, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'Expires must be a UTC timestamp');
  assert.ok(new Date(fields.Expires) > new Date(), 'Expires must be in the future');
  if (fields.Canonical) {
    assert.equal(fields.Canonical, 'https://llm-prefill-decode-visualizer.vercel.app/.well-known/security.txt');
  }
});

test('vercel.json rewrites the extensionless /.well-known/security probe', () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const rw = (vercel.rewrites || []).find(r => r.source === '/.well-known/security');
  assert.ok(rw, 'extensionless /.well-known/security must be rewritten');
  assert.equal(rw.destination, '/.well-known/security.txt');
  // And the sibling pattern it mirrors still exists.
  assert.ok((vercel.rewrites || []).some(r => r.source === '/.well-known/mcp'), 'mcp rewrite untouched');
});

test('contact.html JSON-LD declares a security contactPoint (not just technical support)', () => {
  const html = readFileSync(join(ROOT, 'public', 'contact.html'), 'utf8');
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLd, 'JSON-LD block present');
  const data = JSON.parse(jsonLd[1]); // throws if malformed — part of the contract
  const points = [].concat(data.mainEntity.contactPoint);
  const types = points.map(p => p.contactType);
  assert.ok(types.includes('technical support'), 'existing support channel preserved');
  assert.ok(types.includes('security'), 'a security contactType now exists');
  const sec = points.find(p => p.contactType === 'security');
  assert.match(sec.url, /\/security\/advisories/, 'security channel is private advisories');
});

test('status.html no longer ships meta robots noindex (#909)', () => {
  const html = readFileSync(join(ROOT, 'public', 'status.html'), 'utf8');
  assert.doesNotMatch(html, /name="robots"[^>]*noindex/i, 'noindex directive removed');
  assert.doesNotMatch(html, /noindex/i);
  // The positive signals that contradict it stay intact.
  assert.match(html, /rel="canonical"/);
  assert.match(html, /application\/ld\+json/);
});
