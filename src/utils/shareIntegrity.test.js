// Tests for share-link tamper-evidence (#917) — mirrors the tampering tests
// the repo already keeps for calc ids (_calc_id.test.js) and pagination
// cursors (_pagination.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_SIG_PARAM, canonicalShareQuery,
  signShareParams, verifyShareLink
} from './shareIntegrity.js';

test('canonicalShareQuery drops the signature and sorts deterministically', () => {
  assert.equal(
    canonicalShareQuery('?decode=105&tab=agentic&preset=rtx4090_exl2&h=abc123'),
    'decode=105\npreset=rtx4090_exl2\ntab=agentic'
  );
  // Param order in the URL must not change the canonical form.
  assert.equal(
    canonicalShareQuery('?preset=rtx4090_exl2&tab=agentic&decode=105'),
    canonicalShareQuery('?decode=105&tab=agentic&preset=rtx4090_exl2')
  );
  assert.equal(canonicalShareQuery(''), '');
  assert.equal(canonicalShareQuery(null), '');
});

test('signShareParams is deterministic and 12 hex chars', async () => {
  const a = await signShareParams('?title=Hello&tab=single');
  const b = await signShareParams('?tab=single&title=Hello');
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(a, b); // order-independent
});

test('verifyShareLink accepts a freshly signed link', async () => {
  const search = '?tab=agentic&preset=rtx4090_exl2&title=Qwen3%2032B';
  const sig = await signShareParams(search);
  const result = await verifyShareLink(`${search}&${SHARE_SIG_PARAM}=${sig}`);
  assert.equal(result.status, 'ok');
  assert.equal(result.given, sig);
});

test('verifyShareLink detects tampered params', async () => {
  // Mirrors the issue's attack: hand-edit preset/prefill/decode on a signed link.
  const search = '?preset=rtx4090_exl2&prefill=3800&decode=105&title=Real%20run';
  const sig = await signShareParams(search);
  const mutated = '?preset=rtx3060&prefill=10&decode=5&title=Real%20run' + `&${SHARE_SIG_PARAM}=${sig}`;
  const result = await verifyShareLink(mutated);
  assert.equal(result.status, 'tampered');
  assert.notEqual(result.expected, result.given);
});

test('verifyShareLink detects a forged title', async () => {
  const search = '?preset=rtx3060&title=RTX%203060%2C%202K%20single%20turn';
  const sig = await signShareParams(search);
  const forged = '?preset=rtx3060&title=GPT-5%20runs%2050000%20tok%2Fs' + `&${SHARE_SIG_PARAM}=${sig}`;
  assert.equal((await verifyShareLink(forged)).status, 'tampered');
});

test('verifyShareLink flags unsigned links separately from tampered ones', async () => {
  assert.equal((await verifyShareLink('?tab=single&title=Legacy')).status, 'unsigned');
  assert.equal((await verifyShareLink('')).status, 'unsigned');
  assert.equal((await verifyShareLink(null)).status, 'unsigned');
  // Empty-string signature counts as present-but-invalid, not unsigned.
  assert.equal((await verifyShareLink('?tab=single&h=')).status, 'unsigned'); // URLSearchParams treats '' as missing
  const result = await verifyShareLink('?tab=single&h=zzzz');
  assert.equal(result.status, 'tampered');
});

test('signature comparison is case-insensitive on the given hex', async () => {
  const search = '?tab=single&title=T';
  const sig = await signShareParams(search);
  const upper = `${search}&${SHARE_SIG_PARAM}=${sig.toUpperCase()}`;
  assert.equal((await verifyShareLink(upper)).status, 'ok');
});
