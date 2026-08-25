import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSingleTurnMarkdown, buildAgenticMarkdown } from './exportMarkdown.js';
import { formatTokens } from './presets.js';

// #635/#642 — exported markdown must be locale-independent AND carry one
// canonical number style per column: exact comma-grouped integers everywhere,
// never the lossy ≥10k "12.5k" abbreviation next to exact "9,999" cells in
// the same document.

test('#642 agentic waterfall token columns stay exact past 10k (no k-abbrev)', () => {
  const md = buildAgenticMarkdown({
    numTurns: 3,
    basePromptTokens: 9500,          // turn 1 history <10k → "9,500"
    toolOutputTokensPerTurn: 12000,  // cached turns >10k → previously "12k"
    decodeTokensPerTurn: 250,
    enablePrefixCaching: true,
    prefillSpeed: 3800,
    decodeSpeed: 105,
    deepLink: 'https://example.test/?tab=agentic&turns=3'
  });

  // Turn 1 full ingest row keeps exact grouping...
  assert.match(md, /\| T1 \| full ingest \| 9,500 \| 9,500 \|/);
  // ...and cached turns are EXACT too — no bimodal 12k spelling in the same table.
  assert.match(md, /\| T2 \| cached ⚡ \| 21,750 \| 12,000 \|/);
  assert.doesNotMatch(md, /\|\s*\d+(\.\d+)?k\s*\|/, 'no lossy k-abbreviations in any table cell');
});

test('#642 single-turn inputs table is exact + en-US grouped (#635)', () => {
  const md = buildSingleTurnMarkdown({
    promptTokens: 12345,
    outputTokens: 51200,
    prefillSpeed: 3800,
    decodeSpeed: 105,
    specEnabled: false,
    draftTokens: 4,
    acceptance: 0.7,
    effectiveDecodeSpeed: 105,
    deepLink: 'https://example.test/?tab=single'
  });
  assert.match(md, /\| Prompt length \| 12,345 tok \|/);
  assert.match(md, /\| Target output length \| 51,200 tok \|/);
  assert.doesNotMatch(md, /[\u00A0\u202F]/, 'no host-locale narrow spaces');
});

test('formatTokens itself remains available for human-only prose (bimodality documented)', () => {
  // The UI's compact formatter is untouched; exports simply no longer use it.
  assert.equal(formatTokens(4096), '4,096');
  assert.equal(formatTokens(12500), '12.5k');
});
