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

test('other tabs stay byte-stable (no URL params block when none declared)', () => {
  const single = TABS.find(t => t.id === 'single');
  assert.doesNotMatch(renderTabSection(single), /URL params:/);
});
