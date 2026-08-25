// EngineFlagPicker copy/marker contract (#873 + #878).
//
// The component itself can't be imported under plain node --test (JSX), so
// this pins the source contract that agents and scrapers rely on:
//
// #873: selected flags must never be presented as APPLIED. The panel is
// titled "Selected deltas", carries data-flags-applied="false", and states
// explicitly that the sim runs raw speeds until "Apply to simulation".
// #878: the savings line is labeled as the fixed default 2,048 → 512
// single-turn reference workload, not the surrounding view's workload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'EngineFlagPicker.jsx'),
  'utf8'
);

test('#873: panel is labeled "Selected deltas" — not the lying "Applied deltas"', () => {
  assert.match(src, /Selected deltas/);
  assert.doesNotMatch(src, /Applied deltas/);
});

test('#873: applied-vs-selected state is machine-readable via data-flags-applied', () => {
  assert.match(src, /data-flags-applied="false"/);
});

test('#873: preview states the simulation runs raw speeds until Apply', () => {
  assert.match(src, /Preview only/);
  assert.match(src, /Apply to simulation/);
});

test('#878: savings line names the fixed default 2,048 → 512 reference workload', () => {
  assert.match(src, /Reference workload/);
  assert.match(src, /2,048 → 512 tok single turn/);
  assert.doesNotMatch(src, /Composed effect on this workload/);
});
