// Source-contract pins for the fix-last-12 wave. JSX is not importable under
// plain `node --test`, so these assert on file text — enough to catch silent
// regressions of the #820/#841/#844 fixes in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

// --- #820: ITL histogram bins readable as data ---

test('#820 histogram bins carry data-count/data-from-ms/data-to-ms attrs', () => {
  const src = read('src/components/SingleTurnVisualizer.jsx');
  assert.match(src, /data-bin=\{i\}/);
  assert.match(src, /data-count=\{b\.count\}/);
  assert.match(src, /data-from-ms=\{b\.from\}/);
  assert.match(src, /data-to-ms=\{b\.to\}/);
  // y-scale ceiling exposed so relative bar heights are recoverable
  assert.match(src, /data-max-bin-count=\{maxBinCount\}/);
});

test('#820 histogram has an sr-only ChartDataTable alternative', () => {
  const src = read('src/components/SingleTurnVisualizer.jsx');
  // a ChartDataTable fed from itlHistogram.bins
  assert.match(src, /rows=\{itlHistogram\.bins\.map/);
  assert.match(src, /chartTable\.itlHistogramCaption/);
});

test('#820 i18n keys exist in the en chartTable namespace', () => {
  const json = JSON.parse(read('src/i18n/locales/en/chartTable.json'));
  assert.ok(json.itlHistogramCaption);
  assert.ok(json.itlBin);
  assert.ok(json.tokenCount);
});

// --- #841: no inline min-height beats the coarse-pointer 44px rule ---

test('#841 TemplateGallery/TheoryGuide buttons use .btn-sm and drop inline minHeight', () => {
  for (const f of ['src/components/TemplateGallery.jsx', 'src/components/TheoryGuide.jsx']) {
    const src = read(f);
    assert.ok(!src.includes("minHeight: '30px'"), `${f} must not inline minHeight:30px`);
    assert.match(src, /className="btn btn-sm"/, `${f} must use the btn-sm class`);
  }
});

test('#841 .btn-sm class exists and sets no positive min-height; coarse-pointer rule wins after it', () => {
  const css = read('src/index.css');
  const smIdx = css.indexOf('.btn-sm {');
  assert.notEqual(smIdx, -1, '.btn-sm missing');
  const block = css.slice(smIdx, css.indexOf('}', smIdx));
  // only a reset (min-height: 0) is allowed — never its own positive floor
  const mh = block.match(/min-height:\s*([^;]+);/);
  assert.ok(!mh || mh[1].trim() === '0', '.btn-sm must not set its own positive min-height');
  const coarseIdx = css.indexOf('@media (pointer: coarse)');
  assert.ok(coarseIdx > smIdx, 'coarse-pointer 44px rule must come after .btn-sm so it wins the cascade');
  assert.match(css.slice(coarseIdx), /min-height:\s*44px/);
});

// --- #844: instant-completion escape hatches documented in served llms.txt ---

test('#844 llms.txt documents ?sim=instant and prefers-reduced-motion hatches', () => {
  const txt = read('public/llms.txt');
  assert.match(txt, /### Instant results on animated tabs/);
  assert.match(txt, /\?sim=instant/);
  assert.match(txt, /prefers-reduced-motion: reduce/);
});
