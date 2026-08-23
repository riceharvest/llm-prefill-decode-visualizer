// Drift tests: CHANGELOG.json must stay a faithful machine-readable projection
// of CHANGELOG-API.md, and currentSchemaVersion must match the live wire
// schema version in api/_schema.js. Update both files together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION } from './_schema.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function readChangelogJson() {
  return JSON.parse(readFileSync(`${repoRoot}CHANGELOG.json`, 'utf8'));
}

function readChangelogMd() {
  return readFileSync(`${repoRoot}CHANGELOG-API.md`, 'utf8');
}

/** Parse '- ' bullet paragraphs from a markdown section, joining wrapped
 *  (two-space indented) continuation lines with single spaces. */
function parseBullets(section) {
  const out = [];
  let cur = null;
  for (const line of section.split('\n')) {
    if (line.startsWith('- ')) {
      if (cur !== null) out.push(cur);
      cur = line.slice(2).trim();
    } else if (line.startsWith('  ') && cur !== null && line.trim()) {
      cur += ' ' + line.trim();
    } else if (!line.trim() && cur !== null) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur !== null) out.push(cur);
  return out;
}

/** Parse CHANGELOG-API.md's `## Changelog` section into
 *  { unreleased: [...], versions: [{ version, date, note, changes }] }. */
function parseChangelogMd(text) {
  const m = text.match(/^## Changelog\n([\s\S]*)$/m);
  assert.ok(m, 'CHANGELOG-API.md has a "## Changelog" section');
  const parts = m[1].split(/^### /m).slice(1);
  const result = { unreleased: null, versions: [] };
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = part.slice(0, nl).trim();
    const section = part.slice(nl + 1);
    const bullets = parseBullets(section);
    if (heading.startsWith('Unreleased')) {
      result.unreleased = bullets;
      continue;
    }
    const vm = heading.match(/^(.+?)\s+—\s+(\d{4}-\d{2}-\d{2})(?:\s+\((.+)\))?$/);
    assert.ok(vm, `version heading is parseable: "${heading}"`);
    result.versions.push({
      version: vm[1].trim(),
      date: vm[2],
      note: vm[3] ?? null,
      changes: bullets
    });
  }
  return result;
}

test('CHANGELOG.json exists, parses, and declares its format + source', () => {
  const data = readChangelogJson();
  assert.equal(data.format, 'keep-a-changelog/1.0');
  assert.equal(data.source, 'CHANGELOG-API.md');
  assert.ok(Array.isArray(data.unreleased));
  assert.ok(Array.isArray(data.versions));
});

test('CHANGELOG.json currentSchemaVersion matches SCHEMA_VERSION in _schema.js', () => {
  const data = readChangelogJson();
  assert.equal(data.currentSchemaVersion, SCHEMA_VERSION);
});

test('CHANGELOG.json unreleased bullets match CHANGELOG-API.md exactly', () => {
  const data = readChangelogJson();
  const md = parseChangelogMd(readChangelogMd());
  assert.deepEqual(data.unreleased, md.unreleased);
});

test('CHANGELOG.json versions match CHANGELOG-API.md entries exactly', () => {
  const data = readChangelogJson();
  const md = parseChangelogMd(readChangelogMd());
  assert.equal(data.versions.length, md.versions.length,
    'same number of versioned entries');
  data.versions.forEach((v, i) => {
    assert.equal(v.version, md.versions[i].version, `versions[${i}].version`);
    assert.equal(v.date, md.versions[i].date, `versions[${i}].date`);
    assert.equal(v.note ?? null, md.versions[i].note ?? null, `versions[${i}].note`);
    assert.deepEqual(v.changes, md.versions[i].changes, `versions[${i}].changes`);
  });
});
