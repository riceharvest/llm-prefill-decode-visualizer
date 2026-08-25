import test from 'node:test';
import assert from 'node:assert/strict';

// Issue #399: the llms.txt batching section must document its deep-link
// URL params (breqs/bprompt/bgen/bmax/bchunk/barr) — previously the only
// way to learn them was clicking through the UI and diffing the share link.

import { TABS, renderTabSection } from './generate-llms-txt.mjs';

const batching = TABS.find(t => t.id === 'batching');
const section = renderTabSection(batching);

test('batching tab section lists a URL params block', () => {
  assert.match(section, /- URL params:/);
});

for (const param of ['breqs', 'bprompt', 'bgen', 'bmax', 'bchunk', 'barr']) {
  test(`batching section documents ${param}`, () => {
    assert.ok(
      section.includes(`- ${param}=`),
      `expected a documented ${param} param in:\n${section}`
    );
  });
}

test('bchunk entry notes that slider position ≠ token value', () => {
  const chunkLine = section.split('\n').find(l => l.includes('bchunk='));
  assert.match(chunkLine, /0 disables chunking/);
  assert.match(chunkLine, /slider/i);
});

test('tabs without declared params stay byte-stable (no URL params block)', () => {
  // #490 gave the single-turn tab a full param table, so tabs that DO declare
  // params render them; tabs without any remain block-free.
  const compare = TABS.find(t => t.id === 'compare' && !t.params?.length);
  if (!compare) return; // all tabs declare params now
  assert.doesNotMatch(renderTabSection(compare), /URL params:/);
});
