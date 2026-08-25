// Tests for the shared clipboard helper (issue #501): copy surfaces must be
// able to render an honest success/failure state instead of swallowing every
// clipboard error with a bare `catch {}`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { copyTextToClipboard } from './clipboard.js';

test('resolves true when the clipboard write succeeds', async () => {
  const written = [];
  const ok = await copyTextToClipboard('hello', { writeText: async (t) => { written.push(t); } });
  assert.equal(ok, true);
  assert.deepEqual(written, ['hello']);
});

test('resolves false when the clipboard write rejects (NotAllowedError etc.)', async () => {
  const ok = await copyTextToClipboard('x', {
    writeText: async () => { throw new DOMException('Document is not focused', 'NotAllowedError'); }
  });
  assert.equal(ok, false);
});

test('resolves false when the clipboard API is unavailable (insecure context)', async () => {
  assert.equal(await copyTextToClipboard('x', undefined), false);
  assert.equal(await copyTextToClipboard('x', {}), false);
  assert.equal(await copyTextToClipboard('x', { writeText: 'not-a-function' }), false);
});

test('never throws — failures degrade to false so callers can signal them', async () => {
  const ok = await copyTextToClipboard('x', {
    writeText() { throw new Error('sync throw'); }
  });
  assert.equal(ok, false);
});
