import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompareBatchBody,
  buildCurl,
  buildPython,
  buildTypeScript,
  buildSnippet
} from './copyAsCode.js';

const BODY = buildCompareBatchBody({
  prefillSpeedA: 3800.4,
  decodeSpeedA: 105.2,
  prefillSpeedB: 8500,
  decodeSpeedB: 240,
  batchSize: 8,
  promptTokens: 4096,
  outputTokens: 512
});

test('compare body mirrors the tab as a two-scenario batch', () => {
  assert.equal(BODY.batch.length, 2);
  // speeds are rounded to whole tok/s like the API expects
  assert.deepEqual(BODY.batch[0], {
    model: 'batched',
    prefillSpeed: 3800,
    decodeSpeed: 105,
    batchSize: 8,
    promptTokens: 4096,
    outputTokens: 512
  });
  assert.equal(BODY.batch[1].prefillSpeed, 8500);
  assert.equal(BODY.dry_run, undefined);
});

test('dryRun flag adds top-level dry_run without touching scenarios', () => {
  const dry = buildCompareBatchBody({
    prefillSpeedA: 3800.4, decodeSpeedA: 105.2, prefillSpeedB: 8500, decodeSpeedB: 240,
    batchSize: 8, promptTokens: 4096, outputTokens: 512, dryRun: true
  });
  assert.equal(dry.dry_run, true);
  assert.deepEqual(dry.batch, BODY.batch);
});

function extractJson(snippet) {
  // The -d payload is the single-quoted JSON at the end of the curl line.
  return JSON.parse(snippet.match(/-d '(.+)'$/s)[1]);
}

test('curl snippet embeds the exact batch payload and endpoint', () => {
  const s = buildCurl({ origin: 'https://example.test', body: BODY });
  assert.match(s, /^curl -X POST 'https:\/\/example\.test\/api\/compute'/);
  assert.match(s, /-H 'Content-Type: application\/json'/);
  assert.deepEqual(extractJson(s), BODY);
});

test('python snippet is valid Python (True not true) with the same payload', () => {
  const s = buildPython({ origin: 'https://example.test', body: BODY });
  assert.match(s, /import requests/);
  assert.match(s, /requests\.post\("https:\/\/example\.test\/api\/compute", json=\{/);
  assert.ok(!/\btrue\b|\bfalse\b|\bnull\b/.test(s), 'JSON literals leaked into Python');
  assert.match(s, /"model": "batched"/);
  assert.match(s, /r\.raise_for_status\(\)/);
});

test('python snippet converts booleans for dry_run payloads', () => {
  const dry = buildCompareBatchBody({
    prefillSpeedA: 3800, decodeSpeedA: 105, prefillSpeedB: 8500, decodeSpeedB: 240, dryRun: true
  });
  const s = buildPython({ origin: '', body: dry });
  assert.match(s, /"dry_run": True/);
  assert.ok(!/\btrue\b/.test(s));
});

test('typescript snippet round-trips the payload through fetch + JSON.stringify', () => {
  const s = buildTypeScript({ origin: 'https://example.test', body: BODY });
  assert.match(s, /await fetch\("https:\/\/example\.test\/api\/compute"/);
  const inner = s.match(/JSON\.stringify\((\{[\s\S]*?\})\)\n\}\);/)[1];
  assert.deepEqual(JSON.parse(inner), BODY);
});

test('buildSnippet dispatches all three languages and rejects unknown ones', () => {
  const opts = { origin: 'https://example.test', body: BODY };
  assert.match(buildSnippet('curl', opts), /^curl /);
  assert.match(buildSnippet('python', opts), /^import requests/);
  assert.match(buildSnippet('typescript', opts), /await fetch/);
  assert.throws(() => buildSnippet('ruby', opts), /Unknown snippet language/);
});
