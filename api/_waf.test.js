// Tests for the centralized WAF/bot-protection backoff contract (#466 #526
// #541 #554 #710): the wire signature, the recommended backoff, the spec's
// x-bot-protection mirror, and that llms.txt + both changelogs document it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WAF_BLOCK, WAF_RECOMMENDED_BACKOFF_SECONDS, wafProblemBody, xBotProtection } from './_waf.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(`${repoRoot}${p}`, 'utf8');

test('WAF_BLOCK matches the observed Vercel challenge wire signature', () => {
  assert.equal(WAF_BLOCK.status, 403);
  assert.match(WAF_BLOCK.contentType, /^text\/html/);
  assert.equal(WAF_BLOCK.mitigatedHeader, 'x-vercel-mitigated');
  assert.equal(WAF_BLOCK.mitigatedValue, 'challenge');
  // The whole point of the issue cluster: the edge sends no Retry-After.
  assert.equal(WAF_BLOCK.retryAfterHeader, null);
});

test('recommended backoff is ~10 minutes (observed lockout from #541)', () => {
  assert.ok(WAF_RECOMMENDED_BACKOFF_SECONDS >= 300, 'at least 5 minutes');
  assert.ok(WAF_RECOMMENDED_BACKOFF_SECONDS <= 900, 'not absurdly long');
});

test('wafProblemBody is a stable machine-readable mapping of the block', () => {
  const body = wafProblemBody();
  assert.equal(body.code, 'CHALLENGE_REQUIRED');
  assert.equal(body.status, 403);
  assert.equal(body.retry_after_seconds, WAF_RECOMMENDED_BACKOFF_SECONDS);
  assert.match(body.detail, /x-vercel-mitigated: challenge/);
  assert.match(body.detail, /[Rr]etry-After/);
});

test('xBotProtection exposes detection + backoff for spec consumers', () => {
  const ext = xBotProtection();
  assert.equal(ext.detection.status, 403);
  assert.equal(ext.detection['x-vercel-mitigated'], 'challenge');
  assert.equal(ext.recommended_backoff_seconds, WAF_RECOMMENDED_BACKOFF_SECONDS);
  assert.match(ext.scope, /api\/health/);
  assert.ok(ext.maps_to_problem.code === 'CHALLENGE_REQUIRED');
});

test('/llms.txt documents the WAF challenge signature + cooldown', () => {
  const txt = read('public/llms.txt');
  assert.match(txt, /x-vercel-mitigated: challenge/);
  assert.match(txt, /600s|~10 minutes/);
  assert.match(txt, /no `Retry-After`|no Retry-After/i);
  assert.match(txt, /Edge bot protection/i);
});

test('/api/spec source embeds the x-bot-protection extension', () => {
  assert.match(read('api/_handlers/spec.js'), /'x-bot-protection': xBotProtection\(\)/);
});

test('both changelogs stay in sync about the fix (drift guard)', () => {
  const md = read('CHANGELOG-API.md');
  const json = JSON.parse(read('CHANGELOG.json'));
  assert.match(md, /x-bot-protection/);
  assert.ok(
    json.unreleased.some((b) => b.includes('x-bot-protection')),
    'CHANGELOG.json unreleased mentions x-bot-protection'
  );
});
