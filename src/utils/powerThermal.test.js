import { test } from 'node:test';
import assert from 'node:assert/strict';

const { estimatePower, recommendPsu, matchGpuPower, matchUnifiedPower, POWER_AS_OF } =
  await import('./powerThermal.js');

test('single discrete GPU: per-card TDP, whole-rig load and PSU guidance', () => {
  const p = estimatePower({ gpu: 'RTX 4090', hwClass: 'discrete_gpu', gpuCount: 1 });
  assert.equal(p.kind, 'per_gpu');
  assert.equal(p.tdpWatts, 450);
  assert.equal(p.totalTdpWatts, 450);
  // Whole rig: sustained card draw + platform overhead.
  assert.ok(p.loadWatts > 450 && p.loadWatts < 600, `loadWatts ${p.loadWatts} should be rig-level`);
  assert.equal(p.psuWatts, 850); // 450 board + 350 headroom → round up
  assert.ok(p.psuNote.includes('350'));
  assert.equal(p.asOf, POWER_AS_OF);
});

test('multi-GPU rigs scale TDP/load and get a bigger PSU (#69: the dual-GPU sanity check)', () => {
  const p = estimatePower({ gpu: 'RTX 3090', hwClass: 'discrete_gpu', gpuCount: 2 });
  assert.equal(p.kind, 'per_gpu_x_count');
  assert.equal(p.tdpWatts, 350);
  assert.equal(p.totalTdpWatts, 700);
  assert.ok(p.loadWatts > 700 && p.loadWatts < 900);
  assert.equal(p.psuWatts, 1200); // 700 + 350 → 1050 → round up to 1200
  assert.match(p.note, /2 cards/);
});

test('four-card builds exceed any single consumer PSU — no invented number', () => {
  const p = estimatePower({ gpu: 'RTX 3090', hwClass: 'discrete_gpu', gpuCount: 4 });
  assert.equal(p.totalTdpWatts, 1400);
  assert.equal(p.psuWatts, null);
  assert.match(p.psuNote, /dual-PSU|server platform/i);
});

test('unified-memory systems are whole machines with fixed internal supply', () => {
  const p = estimatePower({ hwClass: 'unified', chip: 'M3 Ultra' });
  assert.equal(p.kind, 'complete_system');
  assert.equal(p.tdpWatts, 140);
  assert.ok(p.loadWatts >= 180);
  assert.equal(p.psuWatts, null);
  assert.match(p.psuNote, /internal supply/i);
});

test('cpu_only and unknown hardware return null — never invent watts', () => {
  assert.equal(estimatePower({ hwClass: 'cpu_only' }), null);
  assert.equal(estimatePower({ gpu: 'Totally Madeup GPU 9000', hwClass: 'discrete_gpu' }), null);
  assert.equal(estimatePower({}), null);
});

test('more-specific GPU patterns win (3090 Ti is not a plain 3090)', () => {
  assert.equal(matchGpuPower('RTX 3090 Ti').tdpWatts, 450);
  assert.equal(matchGpuPower('RTX 3090').tdpWatts, 350);
});

test('recommendPsu rounds up to standard sizes and caps at 1600W', () => {
  assert.equal(recommendPsu(170), 550);   // entry GPU
  assert.equal(recommendPsu(450), 850);   // 4090-class
  assert.equal(recommendPsu(1250), 1600); // still single-PSU territory
  assert.equal(recommendPsu(1400), null); // beyond consumer PSUs
});
