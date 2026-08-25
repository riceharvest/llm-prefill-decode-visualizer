// Deployment reachability of the API changelog (#931 #933).
//
// /api/version advertises links.changelogJson = '/CHANGELOG.json' and
// links.changelogMarkdown = '/CHANGELOG-API.md', and capabilities
// docs.changelog = '/CHANGELOG-API.md' — but both files lived only at repo
// root and were never deployed, so every machine pointer 404'd on the site.
// The fix ships byte-identical copies in public/. These tests keep the
// deployed copies from going stale relative to the source-of-truth files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function readBoth(name) {
  return {
    root: readFileSync(`${repoRoot}${name}`, 'utf8'),
    deployed: readFileSync(`${repoRoot}public/${name}`, 'utf8'),
  };
}

test('public/CHANGELOG.json is a byte-identical copy of the root CHANGELOG.json', () => {
  const { root, deployed } = readBoth('CHANGELOG.json');
  assert.equal(deployed, root,
    'deployed copy drifted from the source-of-truth CHANGELOG.json — re-copy it');
});

test('public/CHANGELOG-API.md is a byte-identical copy of the root CHANGELOG-API.md', () => {
  const { root, deployed } = readBoth('CHANGELOG-API.md');
  assert.equal(deployed, root,
    'deployed copy drifted from the source-of-truth CHANGELOG-API.md — re-copy it');
});

test('deployed CHANGELOG.json parses and carries the contract fields agents gate on', () => {
  const data = JSON.parse(readFileSync(`${repoRoot}public/CHANGELOG.json`, 'utf8'));
  assert.equal(data.format, 'keep-a-changelog/1.0');
  assert.ok(data.currentSchemaVersion, 'currentSchemaVersion present');
  assert.ok(Array.isArray(data.unreleased));
  assert.ok(Array.isArray(data.versions));
});

test('every changelog link advertised by the API resolves to a deployed file', async () => {
  // version.js links (read the literal strings rather than importing the
  // handler so this test stays independent of handler wiring)
  const versionSrc = readFileSync(`${repoRoot}api/_handlers/version.js`, 'utf8');
  const capsSrc = readFileSync(`${repoRoot}api/_handlers/capabilities.js`, 'utf8');
  const advertised = new Set();
  for (const src of [versionSrc, capsSrc]) {
    for (const m of src.matchAll(/'(\/CHANGELOG(?:-API)?\.(?:json|md))'/g)) {
      advertised.add(m[1]);
    }
  }
  assert.ok(advertised.has('/CHANGELOG.json'), 'version.js still advertises /CHANGELOG.json');
  assert.ok(advertised.has('/CHANGELOG-API.md'), 'changelog markdown pointer still advertised');
  for (const path of advertised) {
    const file = `${repoRoot}public${path}`;
    readFileSync(file); // throws if missing → deployment would 404
  }
});
