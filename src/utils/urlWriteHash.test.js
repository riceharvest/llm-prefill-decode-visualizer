// Issue #919 — writeParams must preserve the location hash: the mount-time
// URL sync used to strip #s/<slug> permalinks and ?tab=theory#<anchor>
// fragments from the address bar on the very first render cycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function installWindow({ search = '', pathname = '/', hash = '' } = {}) {
  const calls = [];
  globalThis.window = {
    location: { search, pathname, hash },
    history: {
      replaceState(state, title, url) { calls.push(url); }
    }
  };
  return calls;
}

test('writeParams keeps the #s/<slug> permalink fragment', async () => {
  const { writeParams } = await import('./urlState.js');
  const calls = installWindow({
    search: '?preset=rtx4090_exl2&prompt=2048',
    hash: '#s/Qwen3-32B-GGUF-Q4-on-RTX-4090-24GB'
  });
  writeParams({ tab: 'agentic' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('#s/Qwen3-32B-GGUF-Q4-on-RTX-4090-24GB'), `hash preserved in ${calls[0]}`);
  assert.match(calls[0], /^[^#]*\?[^#]*#/, 'hash comes after the query string');
});

test('writeParams keeps theory anchor fragments', async () => {
  const { writeParams } = await import('./urlState.js');
  const calls = installWindow({ search: '?tab=theory', hash: '#theory-prefill' });
  writeParams({ lang: 'ar' });
  assert.ok(calls[0].endsWith('#theory-prefill'), `anchor preserved: ${calls[0]}`);
});

test('writeParams still works when there is no hash (unchanged legacy behavior)', async () => {
  const { writeParams } = await import('./urlState.js');
  const calls = installWindow({ search: '?a=1' });
  writeParams({ b: 2 });
  assert.equal(calls[0], '/?a=1&b=2');
});

test('writeParams with empty updates keeps bare path + existing hash', async () => {
  const { writeParams } = await import('./urlState.js');
  const calls = installWindow({ search: '', hash: '#s/x' });
  writeParams({});
  assert.equal(calls[0], '/#s/x');
});
