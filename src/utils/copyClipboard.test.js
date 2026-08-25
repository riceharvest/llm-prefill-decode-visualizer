import test from 'node:test';
import assert from 'node:assert/strict';

// Issue #401: "Copy MD" must not claim success when the clipboard write
// failed. copyMarkdownToClipboard treats an async-clipboard rejection as
// authoritative and only falls back to execCommand() when the Clipboard
// API is entirely unavailable.

import { copyMarkdownToClipboard } from './exportMarkdown.js';

function withEnv({ clipboard, execCommand }, fn) {
  const realNavigator = globalThis.navigator;
  const realDocument = globalThis.document;
  if (clipboard !== undefined) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard },
      configurable: true,
      writable: true
    });
  }
  globalThis.document = {
    createElement: () => ({
      style: {},
      select: () => {},
      remove: () => {},
      set value(v) {}
    }),
    body: { appendChild: () => {} },
    execCommand
  };
  return Promise.resolve(fn()).finally(() => {
    if (realNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: realNavigator, configurable: true });
    globalThis.document = realDocument;
  });
}

test('clipboard writeText success returns true', async () => {
  let written = '';
  await withEnv(
    { clipboard: { writeText: async (t) => { written = t; } } },
    async () => {
      assert.equal(await copyMarkdownToClipboard('# hi'), true);
      assert.equal(written, '# hi');
    }
  );
});

test('clipboard writeText rejection is authoritative — returns false, no execCommand fallback (#401)', async () => {
  let execCalled = false;
  await withEnv(
    {
      clipboard: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } },
      execCommand: () => { execCalled = true; return true; }
    },
    async () => {
      assert.equal(await copyMarkdownToClipboard('# hi'), false);
      assert.equal(execCalled, false);
    }
  );
});

test('execCommand fallback only runs when the Clipboard API is unavailable', async () => {
  let execCalled = false;
  await withEnv(
    { clipboard: undefined, execCommand: () => { execCalled = true; return true; } },
    async () => {
      assert.equal(await copyMarkdownToClipboard('# hi'), true);
      assert.equal(execCalled, true);
    }
  );
});

test('failed execCommand fallback reports failure instead of lying', async () => {
  await withEnv(
    { clipboard: undefined, execCommand: () => false },
    async () => {
      assert.equal(await copyMarkdownToClipboard('# hi'), false);
    }
  );
});
