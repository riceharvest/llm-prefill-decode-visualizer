// Issue #547: /api/export silently returns the comparable=true subset of
// /api/runs while both discovery surfaces advertise them side-by-side with no
// cross-reference. Fix is docs/discovery-only (no wire change): every surface
// that names one endpoint now names the other and states the subset relation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES } from './_route_table.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('#547: route table cross-references export <-> runs', () => {
  const byPath = Object.fromEntries(ROUTES.map(r => [r.path, r]));
  const exp = byPath['/export'];
  const runs = byPath['/runs'];
  assert.match(exp.description, /\/api\/runs\?comparable=true/, '/export description must point at /api/runs?comparable=true');
  assert.match(runs.description, /\/api\/export/, '/runs description must mention the legacy /api/export alias');
});

test('#547: agent index.json entries cross-reference each other', () => {
  const index = JSON.parse(readFileSync(path.join(root, 'public/api/agent/index.json'), 'utf8'));
  const byPath = Object.fromEntries(index.endpoints.map(e => [e.path, e]));
  assert.match(byPath['/api/export'].description, /\/api\/runs/);
  assert.match(byPath['/api/runs'].description, /\/api\/export/);
});

test('#547: served llms.txt documents the subset relation', () => {
  const llms = readFileSync(path.join(root, 'public/llms.txt'), 'utf8');
  assert.match(llms, /legacy `GET \/api\/export` returns exactly this dump with `\?comparable=true`/);
});
