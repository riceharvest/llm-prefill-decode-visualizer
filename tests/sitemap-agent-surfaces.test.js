import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// #647 — sitemap.xml must include every agent-facing surface that
// llms.txt / robots.txt / head links treat as first-class entry points.

const REQUIRED_PATHS = [
  '/llms.txt',
  '/llms-full.txt',
  '/agents.json',
  '/api/spec',
  '/api/agent/index.json',
  '/.well-known/mcp.json',
  '/api/mcp',
  '/status.html',
  '/about.html',
  '/contact.html',
  '/privacy.html',
  '/api/health'
];

test('#647 generator AGENT_PATHS lists all llms.txt-referenced surfaces', () => {
  const src = readFileSync(join(ROOT, 'scripts/generate-sitemap.mjs'), 'utf8');
  const block = src.slice(src.indexOf('AGENT_PATHS'), src.indexOf('];', src.indexOf('AGENT_PATHS')));
  for (const p of REQUIRED_PATHS) {
    assert.ok(block.includes(`'${p}'`), `generator must list ${p}`);
  }
});

test('#647 committed public/sitemap.xml carries the new entries', () => {
  const xml = readFileSync(join(ROOT, 'public/sitemap.xml'), 'utf8');
  for (const p of REQUIRED_PATHS) {
    assert.ok(xml.includes(`<loc>https://llm-prefill-decode-visualizer.vercel.app${p}</loc>`), `sitemap must include ${p}`);
  }
});

test('#647 sitemap stays valid XML with one <url> per required path', () => {
  const xml = readFileSync(join(ROOT, 'public/sitemap.xml'), 'utf8');
  assert.ok(xml.startsWith('<?xml version="1.0"'));
  assert.ok(xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
  const opens = (xml.match(/<url>/g) || []).length;
  const closes = (xml.match(/<\/url>/g) || []).length;
  assert.equal(opens, closes);
  assert.ok(opens >= 51 + 7, 'compare pairs + root + agent surfaces all present');
});
