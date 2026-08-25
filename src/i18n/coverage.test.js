// Locale translation-coverage signal (#797).
//
// Pins (a) the pure coverage math and (b) the declared coverage numbers in
// each locale's _meta.json so they can never silently drift from reality.
// A stale "coverage" claim fails CI here instead of misleading agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { flattenKeys, localeCoverage } from './coverage.js';

test('flattenKeys returns dotted leaf paths and skips the meta namespace', () => {
  const dict = {
    meta: { name: 'X' },
    header: { brandTitle: 'Hi', nav: ['a', 'b'] },
    common: { copy: { hint: '{n} items' } }
  };
  assert.deepEqual(flattenKeys(dict).sort(), [
    'common.copy.hint',
    'header.brandTitle',
    'header.nav'
  ]);
});

test('localeCoverage counts present leaves against English', () => {
  const en = { a: { x: '1', y: '2' }, b: '3' };
  const partial = { a: { x: 'eins' }, c: 'extra keys do not count' };
  const cov = localeCoverage(en, partial);
  assert.equal(cov.total, 3);
  assert.equal(cov.translated, 1);
  assert.equal(cov.missing, 2);
  assert.ok(Math.abs(cov.fraction - 1 / 3) < 1e-9);
});

test('localeCoverage is 100% when target mirrors source and safe on empty dicts', () => {
  assert.equal(localeCoverage({ a: '1' }, { a: 'one' }).fraction, 1);
  assert.deepEqual(localeCoverage({}, {}), { total: 0, translated: 0, missing: 0, fraction: 1 });
});

/** Load every namespace dict of a locale dir (no _meta). */
function loadLocale(dir) {
  const out = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file === '_meta.json') continue;
    out[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
  }
  return out;
}

test('declared _meta.json coverage matches computed reality for every locale', () => {
  const localesRoot = fileURLToPath(new URL('./locales/', import.meta.url));
  const enDir = `${localesRoot}en`;
  const en = loadLocale(enDir);
  const total = flattenKeys(en).length;
  assert.ok(total > 0, 'English namespaces are present');

  for (const entry of readdirSync(localesRoot)) {
    if (!statSync(`${localesRoot}${entry}`).isDirectory()) continue;
    const metaPath = `${localesRoot}${entry}/_meta.json`;
    if (!statSync(metaPath).isFile()) continue; // eslint-disable-line no-continue
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    assert.ok(meta.coverage, `${entry}/_meta.json declares a coverage object`);
    const expected = entry === 'en'
      ? { total, translated: total, missing: 0 }
      : localeCoverage(en, loadLocale(`${localesRoot}${entry}`));
    assert.equal(meta.coverage.total, expected.total, `${entry}: coverage.total`);
    assert.equal(meta.coverage.translated, expected.translated, `${entry}: coverage.translated`);
    assert.equal(meta.coverage.missing, expected.missing, `${entry}: coverage.missing`);
  }
});
