// Tests for the per-view URL param registry + share-link scoping helper
// (#445 #446): share/embed links must carry only the active view's params
// plus globals, instead of the union of every view visited this session.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOBAL_URL_PARAMS,
  SIMULATOR_TABS,
  TAB_URL_PARAMS,
  scopeShareSearch
} from './urlState.js';

// The ~30-param URL from issue #445's repro: every view's params after one
// tour of all views.
const TOUR_QS = [
  'prompt=2048', 'output=512', 'tab=single', 'preset=rtx4090_exl2',
  'prefill=3800', 'decode=105', 'sim=1',
  'turns=4', 'sprompt=1500', 'tool=800', 'thought=250', 'cache=1',
  'breqs=12', 'bprompt=2000', 'bgen=256', 'bmax=8', 'bchunk=512', 'barr=150',
  'hwA=groq', 'hwB=rtx4090_exl2', 'cp=4096', 'co=512',
  'tcoHw=rtx4090_exl2', 'tcoW=450', 'tcoKwh=0.30', 'tcoCapex=2500', 'tcoAmort=24',
  'qtm=qwen3-6-27b', 'abA=groq', 'abB=rtx4090_exl2', 'abp=2048', 'abo=512'
].join('&');

function keys(qs) {
  return [...new URLSearchParams(qs).keys()].sort();
}

test('#445: share link from Diff keeps only diff + global params', () => {
  const scoped = scopeShareSearch(TOUR_QS, 'diff');
  assert.deepEqual(keys(scoped), ['decode', 'prefill', 'preset', 'tab'].sort());
});

test('#445: share link keeps the active view\'s full param set + globals', () => {
  const scoped = scopeShareSearch(TOUR_QS, 'compare');
  assert.deepEqual(keys(scoped), [
    // globals present in TOUR_QS
    'preset', 'prefill', 'decode', 'tab',
    // compare-owned
    'hwA', 'hwB', 'cp', 'co', 'tcoHw', 'tcoW', 'tcoKwh', 'tcoCapex', 'tcoAmort',
    // compare tab renders SpeedControls/EngineFlagPicker → sim kept
    'sim',
    // quant matrix rides with compare
    'qtm'
  ].sort());
});

test('#446: exactly one workload namespace survives per shared link', () => {
  for (const [tab, ns] of [
    ['single', ['prompt', 'output']],
    ['agentic', ['sprompt', 'tool']],
    ['batching', ['bprompt', 'bgen']],
    ['compare', ['cp', 'co']],
    ['ab', ['abp', 'abo']]
  ]) {
    const scopedKeys = keys(scopeShareSearch(TOUR_QS, tab));
    for (const other of [['prompt', 'output'], ['sprompt', 'tool'], ['bprompt', 'bgen'], ['cp', 'co'], ['abp', 'abo']]) {
      if (other.join() === ns.join()) continue;
      for (const k of other) assert.ok(!scopedKeys.includes(k), `${tab} link must not carry foreign workload key ${k}`);
    }
    for (const k of ns) assert.ok(scopedKeys.includes(k), `${tab} link lost its own key ${k}`);
  }
});

test('#448 (share half): sim/flags scoped to simulator tabs only', () => {
  const qs = 'tab=x&sim=instant&flags=spec_decode&runA=a&runB=b';
  for (const tab of SIMULATOR_TABS) {
    assert.ok(scopeShareSearch(qs, tab).includes('sim='), `sim kept on ${tab}`);
    assert.ok(scopeShareSearch(qs, tab).includes('flags='), `flags kept on ${tab}`);
  }
  for (const tab of ['diff', 'shortlist', 'kvcache', 'theory']) {
    assert.ok(!scopeShareSearch(qs, tab).includes('sim='), `sim dropped on ${tab}`);
    assert.ok(!scopeShareSearch(qs, tab).includes('flags='), `flags dropped on ${tab}`);
  }
});

test('#449: qtm belongs to compare only', () => {
  const qs = 'tab=kvcache&qtm=qwen3-6-27b&ctx=8192';
  assert.ok(!scopeShareSearch(qs, 'kvcache').includes('qtm'));
  assert.ok(scopeShareSearch(qs, 'compare').includes('qtm=qwen3-6-27b'));
});

test('unknown tab scopes down to globals only', () => {
  const scoped = scopeShareSearch(TOUR_QS, 'not-a-tab');
  assert.deepEqual(keys(scoped), ['decode', 'prefill', 'preset', 'tab'].sort());
});

test('duplicate keys and value order are preserved for allowed params', () => {
  const qs = 'tab=ab&abA=groq&abA=groq&junk=1&abo=512';
  assert.equal(scopeShareSearch(qs, 'ab'), 'tab=ab&abA=groq&abA=groq&abo=512');
});

test('registry pins: every view has an entry and global list is exact', () => {
  assert.deepEqual(GLOBAL_URL_PARAMS, [
    'tab', 'preset', 'prefill', 'decode', 'lang', 'autoplay',
    'lmxOrder', 'lmxModel', 'lmxQuant', 'lmxRun', 'lmxHw'
  ]);
  assert.deepEqual(
    Object.keys(TAB_URL_PARAMS).sort(),
    ['ab', 'agentic', 'batching', 'compare', 'diff', 'kvcache', 'shortlist', 'single', 'theory']
  );
  // Every registered param is unique within its view.
  for (const [tab, params] of Object.entries(TAB_URL_PARAMS)) {
    assert.equal(new Set(params).size, params.length, `${tab} has duplicate params`);
  }
});
