// Source-level a11y/theme contracts (issues #1002 and #1010).
// These pin structural invariants that only manifest at render time:
//  - /compare/* must resolve <html data-theme> like the app routes (#1002)
//  - each animated view must mount exactly ONE polite live region (#1010)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('compare entry point applies the shared theme module before render (#1002)', () => {
  const main = read('src/compare/main.jsx');
  assert.match(main, /import\s+'\.\.\/utils\/theme'/,
    '/compare/* renders without <html data-theme> unless src/utils/theme is imported ahead of the app render');
});

test('animated views keep a single throttled announcer (#1010)', () => {
  for (const file of [
    'src/components/SingleTurnVisualizer.jsx',
    'src/components/AgenticVisualizer.jsx'
  ]) {
    const src = read(file);
    // The throttled AriaLiveRegion component is the view's sole announcer
    assert.match(src, /<AriaLiveRegion\s+message=/,
      `${file} must render the throttled AriaLiveRegion`);
    // No inline aria-live region: the #63 sr summary must be plain text, or
    // every transition is announced twice and the 5 s throttle is defeated
    assert.doesNotMatch(src, /aria-live=/,
      `${file} must not define its own aria-live region alongside AriaLiveRegion`);
    assert.doesNotMatch(src, /className="visually-hidden"\s+role="status"/);
  }
});
