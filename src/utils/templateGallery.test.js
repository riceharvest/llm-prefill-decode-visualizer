import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_GALLERY, templateById } from './templateGallery.js';

test('gallery ships the four launch templates', () => {
  const ids = TEMPLATE_GALLERY.map(t => t.id);
  assert.ok(ids.includes('agent-slow-turn5'));
  assert.ok(ids.includes('prefix-caching-128k'));
  assert.ok(ids.includes('rpi5-7b'));
  assert.ok(ids.includes('fp16-vs-int4-kv'));
});

test('every template has the fields the card grid renders', () => {
  for (const t of TEMPLATE_GALLERY) {
    assert.ok(t.id && t.question && t.icon && t.tagline, `missing card fields: ${t.id}`);
    assert.ok(t.blurb.length >= 80, `blurb too short to be a theory blurb: ${t.id}`);
    assert.ok(Array.isArray(t.chips) && t.chips.length > 0, `missing chips: ${t.id}`);
    assert.equal(typeof t.demo, 'object');
    assert.ok(t.demo.tab, `demo must target a tab: ${t.id}`);
  }
});

test('demo params only reference tabs and hardware that exist', () => {
  const tabs = ['single', 'agentic', 'batching', 'compare', 'ab', 'diff', 'shortlist', 'kvcache', 'theory', 'curriculum'];
  const hwIds = ['rtx4090_exl2', 'dual_rtx3090', 'rtx3090_llamacpp', 'mac_ultra', 'rtx3060_entry', 'groq', 'h100', 'rpi5', 'custom'];
  for (const t of TEMPLATE_GALLERY) {
    assert.ok(tabs.includes(t.demo.tab), `unknown tab in ${t.id}: ${t.demo.tab}`);
    if (t.demo.preset) {
      assert.ok(hwIds.includes(t.demo.preset), `unknown preset in ${t.id}: ${t.demo.preset}`);
    }
  }
});

test('templateById resolves known ids and null for unknown', () => {
  assert.equal(templateById('rpi5-7b').question, 'Can a Raspberry Pi 5 run a 7B?');
  assert.equal(templateById('nope'), null);
});

test('template ids are unique', () => {
  const ids = TEMPLATE_GALLERY.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
});
