import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from './shareClipboard.js';

test('copyText resolves true when the clipboard write succeeds', async () => {
  const written = [];
  const ok = await copyText('https://example.test/?a=1', async (t) => { written.push(t); });
  assert.equal(ok, true);
  assert.deepEqual(written, ['https://example.test/?a=1']);
});

test('copyText resolves false (never throws) when the write rejects', async () => {
  // Issue #726 regression: this is the path that used to be swallowed and
  // still shown to the user as a successful copy.
  const ok = await copyText('x', async () => { throw new Error('NotAllowedError'); });
  assert.equal(ok, false);
});

test('copyText resolves false when no Clipboard API is available', async () => {
  const ok = await copyText('x', undefined);
  assert.equal(ok, false);
});
