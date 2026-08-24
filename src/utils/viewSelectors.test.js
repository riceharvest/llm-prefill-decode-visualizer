// Selector-contract drift guard for issue #806.
//
// The active view must stay machine-readable: <main data-active-tab="…"> in
// App.jsx plus a `data-view="<id>" role="tabpanel"` root on each of the nine
// view components. These attributes are the only way for headless agents to
// read/await view state (React renders <select> values as DOM properties, not
// attributes). This test fails if a view root loses its marker or a new view
// is added without one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const componentSrc = name => readFileSync(new URL(`../components/${name}.jsx`, import.meta.url), 'utf8');

// tab id -> owning component
const VIEWS = {
  single: 'SingleTurnVisualizer',
  agentic: 'AgenticVisualizer',
  batching: 'BatchingVisualizer',
  compare: 'HardwareComparison',
  ab: 'ABReplay',
  diff: 'RunDiff',
  shortlist: 'HardwareShortlist',
  kvcache: 'KVCacheCalculator',
  theory: 'TheoryGuide'
};

test('App.jsx exposes the active view via data-active-tab on <main>', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /<main[^>]*data-active-tab=\{activeTab\}/);
});

for (const [tab, component] of Object.entries(VIEWS)) {
  test(`view "${tab}" root carries data-view + role="tabpanel" (${component})`, () => {
    const src = componentSrc(component);
    assert.match(src, new RegExp(`data-view="${tab}"`));
    assert.match(src, /role="tabpanel"/);
  });
}

test('every tab id known to the app has a contract entry here', () => {
  // Guard against a new view being mounted in App.jsx without a selector
  // contract entry above.
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const mounted = [...app.matchAll(/activeTab === '([a-z]+)'/g)].map(m => m[1]);
  for (const tab of new Set(mounted)) {
    assert.ok(tab in VIEWS, `view "${tab}" is mounted in App.jsx but has no data-view contract entry`);
  }
});
