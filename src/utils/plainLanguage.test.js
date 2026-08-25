import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPlainMode, setPlainMode, PLAIN_TERMS } from './plainLanguage.js';
import { plainify, tPlain } from '../i18n/strings.js';

// Minimal localStorage shim so the preference helpers work under node:test.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

test('plain-language mode defaults to off and round-trips', () => {
  assert.equal(getPlainMode(), false);
  setPlainMode(true);
  assert.equal(getPlainMode(), true);
  setPlainMode(false);
  assert.equal(getPlainMode(), false);
});

test('plainify is a no-op while the mode is off', () => {
  const text = 'Decode is a GEMV bottleneck; TTFT comes from prefill.';
  assert.equal(plainify(text), text);
});

test('plainify swaps dense terms for plain equivalents when on', () => {
  setPlainMode(true);
  try {
    assert.equal(
      plainify('TTFT is set by prefill speed.'),
      'Wait before the first word appears is set by reading the whole prompt first speed.'
    );
    // Issue example #2 ('GEMV' → 'memory-speed math step'); the match keeps
    // the original's capitalization, and nested jargon ("token") swaps too.
    assert.match(plainify('decode runs a GEMV per token.'), /[Mm]emory-speed math step per word piece\./);
    // Multi-word terms win over substrings
    assert.match(plainify('the KV cache grows linearly'), /notes on everything read so far grows/i);
  } finally {
    setPlainMode(false);
  }
});

test('plainify leaves non-strings untouched', () => {
  setPlainMode(true);
  try {
    assert.equal(plainify(undefined), undefined);
    assert.equal(plainify(42), 42);
  } finally {
    setPlainMode(false);
  }
});

test('tPlain resolves a key then applies the rewrite only when on', () => {
  const technical = tPlain('theory.decodeIntroBefore');
  assert.match(technical, /KV cache/);
  setPlainMode(true);
  try {
    const plain = tPlain('theory.decodeIntroBefore');
    assert.doesNotMatch(plain, /\bKV cache\b/i);
    assert.match(plain, /notes on everything read so far/i);
  } finally {
    setPlainMode(false);
  }
});

test('every dictionary term exposes short, plain and long strings', () => {
  for (const key of PLAIN_TERMS) {
    for (const field of ['short', 'plain', 'long']) {
      assert.equal(typeof tPlain(`plainLanguage.terms.${key}.${field}`), 'string');
    }
  }
});

// ---------- #583: glossary deep-link anchors ----------

test('glossaryTermId mints stable, URL-safe per-term anchors', async () => {
  const { glossaryTermId } = await import('./plainLanguage.js');
  assert.equal(glossaryTermId('prefill'), 'glossary-prefill');
  assert.equal(glossaryTermId('kvCache'), 'glossary-kvcache');
  assert.equal(glossaryTermId('computeBound'), 'glossary-computebound');
  assert.equal(glossaryTermId('prefix caching!'), 'glossary-prefix-caching');
  // Stable across calls and unique across the dictionary.
  const ids = PLAIN_TERMS.map(glossaryTermId);
  assert.equal(new Set(ids).size, ids.length);
});

test('JargonGlossary wires glossary anchors + hash activation (#583 source contract)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../components/JargonGlossary.jsx', import.meta.url), 'utf8');
  assert.match(src, /id=\{glossaryTermId\(term\)\}/, 'each term wrapper must carry its anchor id');
  assert.match(src, /hashchange/, 'must react to hash changes');
  assert.match(src, /#glossary-/, 'must recognize the #glossary- prefix');
  assert.match(src, /scrollIntoView/, 'must scroll to the requested term');
  assert.match(src, /setOpen\(true\)/, 'a glossary hash must unfold the collapsed <details>');
});
