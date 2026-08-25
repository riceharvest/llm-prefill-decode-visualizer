import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TEMPLATE_GALLERY, templateById } from './templateGallery.js';

const here = dirname(fileURLToPath(import.meta.url));
const templatesNs = locale =>
  JSON.parse(readFileSync(join(here, '../i18n/locales', locale, 'templates.json'), 'utf8'));

test('gallery ships the four launch templates', () => {
  const ids = TEMPLATE_GALLERY.map(t => t.id);
  assert.ok(ids.includes('agent-slow-turn5'));
  assert.ok(ids.includes('prefix-caching-128k'));
  assert.ok(ids.includes('rpi5-7b'));
  assert.ok(ids.includes('fp16-vs-int4-kv'));
});

test('every template has its demo config and an icon', () => {
  for (const t of TEMPLATE_GALLERY) {
    assert.ok(t.id && t.icon, `missing card fields: ${t.id}`);
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
  assert.equal(templateById('rpi5-7b').id, 'rpi5-7b');
  assert.equal(templateById('nope'), null);
});

test('template ids are unique', () => {
  const ids = TEMPLATE_GALLERY.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

// #587: all user-facing copy lives in the i18n templates namespace, keyed by
// template id — the data module carries none of it.
test('en templates namespace covers every template and section string', () => {
  const en = templatesNs('en');
  assert.ok(en.heading.length > 0);
  assert.ok(en.intro.length >= 40, 'intro too short');
  assert.ok(en.why && en.loadSimulation && en.loadAria.includes('{question}'));
  for (const t of TEMPLATE_GALLERY) {
    const copy = en.templates[t.id];
    assert.ok(copy, `missing en copy for ${t.id}`);
    assert.ok(copy.question && copy.tagline, `missing question/tagline: ${t.id}`);
    assert.ok(copy.blurb.length >= 80, `blurb too short to be a theory blurb: ${t.id}`);
    assert.ok(Array.isArray(copy.chips) && copy.chips.length > 0, `missing chips: ${t.id}`);
  }
});

test('ar translations are complete for every template key (#587)', () => {
  const ar = templatesNs('ar');
  for (const key of ['heading', 'intro', 'why', 'loadSimulation', 'loadAria']) {
    assert.ok(ar[key], `ar missing templates.${key}`);
  }
  for (const t of TEMPLATE_GALLERY) {
    const copy = ar.templates?.[t.id];
    assert.ok(copy, `ar missing copy for ${t.id}`);
    for (const field of ['question', 'tagline', 'blurb', 'chips']) {
      assert.ok(copy[field], `ar.${t.id} missing ${field}`);
    }
    assert.equal(copy.chips.length, templatesNs('en').templates[t.id].chips.length);
  }
});
