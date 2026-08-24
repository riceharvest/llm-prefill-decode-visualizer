import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rigLabel,
  sourceRunLinkLabel,
  demoButtonLabel,
  tableLiveStatus
} from './accessibleLabels.js';

test('rigLabel: discrete gpu with count and vram', () => {
  assert.equal(rigLabel({ gpu: 'RTX 3090', gpuCount: 2, vramGb: 24 }), '2× RTX 3090 24GB');
  assert.equal(rigLabel({ gpu: 'RTX 4090', vramGb: 24 }), 'RTX 4090 24GB');
});

test('rigLabel: unified chip, cpu fallback, unknown', () => {
  assert.equal(rigLabel({ hwClass: 'UNIFIED', chip: 'M3 Max', unifiedMemoryGb: 36 }), 'M3 Max 36GB');
  assert.equal(rigLabel({ hwClass: 'CPU_ONLY', cpu: 'Threadripper' }), 'Threadripper');
  assert.equal(rigLabel({}), 'Unknown system');
});

test('#464: source-run link name carries row context (rig · family · quant)', () => {
  const label = sourceRunLinkLabel({
    gpu: 'RTX 4090', vramGb: 24,
    modelFamily: 'qwen3-27b',
    quantization: 'EXL2-4.5'
  });
  assert.match(label, /^View source run: /);
  assert.ok(label.includes('RTX 4090 24GB'));
  assert.ok(label.includes('qwen3-27b'));
  assert.ok(label.includes('EXL2-4.5'));
  // Names must differ between rows that share the visible link text.
  const other = sourceRunLinkLabel({ gpu: 'RTX 3060', vramGb: 12, modelFamily: 'llama-70b', quantization: 'Q4_K_M' });
  assert.notEqual(label, other);
});

test('#464: source-run label degrades gracefully without optional fields', () => {
  const label = sourceRunLinkLabel({ hardware: 'some-rig' }, 'Quelle ansehen');
  assert.equal(label, 'Quelle ansehen: some-rig');
});

test('#461: theory FAQ demo button name pairs action text with the question', () => {
  const q = 'Why is my first token so slow, then the rest are fast?';
  assert.equal(
    demoButtonLabel(q, 'Try it in the visualizer'),
    'Try it in the visualizer: Why is my first token so slow, then the rest are fast?'
  );
  // Distinct questions produce distinct accessible names.
  assert.notEqual(demoButtonLabel(q, 'Try it'), demoButtonLabel('Another question?', 'Try it'));
});

test('#465: table live status selects per-state message, empty when idle/unknown', () => {
  const messages = { idle: '', loading: 'Loading…', error: 'Failed: boom', ready: '37 rows loaded' };
  assert.equal(tableLiveStatus('idle', messages), '');
  assert.equal(tableLiveStatus('loading', messages), 'Loading…');
  assert.equal(tableLiveStatus('error', messages), 'Failed: boom');
  assert.equal(tableLiveStatus('ready', messages), '37 rows loaded');
  assert.equal(tableLiveStatus('bogus', messages), '');
});
