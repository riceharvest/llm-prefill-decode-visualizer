// Issues #527 / #528 / #531 / #532 / #533 — deep-link + page-route contract
// documentation in the SERVED public/llms.txt:
//  - every view's URL-param vocabulary is documented (was: 7 of ~50 params);
//  - preset=lmx:<runId> syntax is documented;
//  - the page route is stated to be HTML-only with API pointers (#528);
//  - curriculum + /embed are documented (#532);
//  - ?lang= is documented incl. fallback signal (#533);
//  - shortlist UI→API filter mapping (minDecode/maxVramGb) is documented
//    and declared in /api/spec's /api/best operation (#527).
//
// Drift guard: every documented param name must still be READ somewhere in
// src/ — renaming a param without updating llms.txt fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const llms = readFileSync(join(root, 'public', 'llms.txt'), 'utf8');

function allSrcText() {
  let out = '';
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.jsx?$/.test(entry.name)) out += readFileSync(p, 'utf8');
    }
  };
  walk(join(root, 'src'));
  return out;
}

test('llms.txt states the page route is HTML-only and points at the API (#528)', () => {
  assert.match(llms, /page route is HTML-only/);
  assert.match(llms, /\?format=json/);
  assert.match(llms, /Accept: application\/json/);
});

test('llms.txt documents preset=lmx:<runId> composite syntax (#531)', () => {
  assert.match(llms, /preset=lmx:<runId>/);
});

test('llms.txt documents the lang param + fallback signal (#533)', () => {
  assert.match(llms, /`lang=en\|ar`/);
  assert.match(llms, /data-lang-fallback/);
});

test('llms.txt documents curriculum + /embed shell (#532)', () => {
  assert.match(llms, /\/embed\?tab=<id>/);
  assert.match(llms, /\?tab=curriculum/);
});

const REQUIRED_PARAMS = [
  // single-turn
  'prompt=', 'output=', 'spec=1', 'draftK=', 'acc=', 'jitPct=', 'ctxHalf=', 'imgN=',
  // agentic
  'turns=', 'sprompt=', 'tool=', 'thought=',
  // batching
  'breqs=', 'bprompt=', 'bgen=', 'bmax=', 'bchunk=', 'barr=',
  // compare + TCO
  'hwA=', 'hwB=', 'cp=', 'co=', 'qtm=', 'tcoHw=', 'tcoW=', 'tcoKwh=', 'tcoCloud=', 'tcoCapex=',
  // A/B
  'abA=', 'abB=', 'abp=', 'abo=',
  // diff
  'runA=', 'runB=',
  // shortlist
  'sd=', 'sv=', 'sm=', 'sq=',
  // kvcache + planner
  'ctx=', 'prec=', 'vram=', 'gpu=', 'wp=', 'oh=', 'wgb=',
  'gpus=', 'par=', 'bus=', 'card=',
  // app-level
  'sim=', 'flags=', 'autoplay=1', 'title=',
];

test('every view family has its deep-link params documented in llms.txt (#531)', () => {
  for (const p of REQUIRED_PARAMS) {
    assert.ok(llms.includes(`\`${p}`) || llms.includes(`${p}<`) || new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(llms),
      `llms.txt does not document param '${p}'`);
  }
});

test('documented params are actually read by the app (no phantom docs)', () => {
  const src = allSrcText();
  const names = ['sd', 'sv', 'sm', 'sq', 'hwA', 'hwB', 'cp', 'co', 'qtm',
    'tcoHw', 'tcoW', 'tcoKwh', 'tcoCloud', 'tcoCapex', 'tcoAmort',
    'abA', 'abB', 'abp', 'abo', 'runA', 'runB',
    'gpus', 'par', 'bus', 'card', 'wprec', 'wgb', 'oh', 'wp'];
  for (const n of names) {
    assert.match(src, new RegExp(`['"\`]${n}['"\`]`),
      `param ${n} documented in llms.txt but not read by any component`);
  }
});

test('shortlist UI filters map to /api/best minDecode/maxVramGb, declared in spec (#527)', () => {
  assert.match(llms, /sd→GET \/api\/best\?minDecode=/);
  assert.match(llms, /&maxVramGb=/);
  // The OpenAPI spec must declare both working filters.
  const specSrc = readFileSync(join(root, 'api/_handlers/spec.js'), 'utf8');
  assert.match(specSrc, /name: 'minDecode'/);
  assert.match(specSrc, /name: 'maxVramGb'/);
  // And the wire must honor them (regression guard on best.js).
  const bestSrc = readFileSync(join(root, 'api/_handlers/best.js'), 'utf8');
  assert.match(bestSrc, /q\.minDecode/);
  assert.match(bestSrc, /q\.maxVramGb/);
});

test('regenerating llms.txt keeps these sections byte-identical (idempotent)', () => {
  const before = readFileSync(join(root, 'public', 'llms.txt'), 'utf8');
  execFileSync(process.execPath, [join(root, 'scripts', 'generate-llms-txt.mjs')], { cwd: root, stdio: 'pipe' });
  assert.equal(readFileSync(join(root, 'public', 'llms.txt'), 'utf8'), before);
});
