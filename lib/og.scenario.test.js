import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOgParams } from '../api/_handlers/og.js';

const sp = params => new URLSearchParams(params);

test('#769 a known scenario id parses cleanly (scenarioUnknown false)', () => {
  const cfg = parseOgParams(sp({ scenario: 'rag' }));
  assert.equal(cfg.scenarioUnknown, false);
  assert.equal(cfg.scenarioRequested, null);
});

test('#769 an unknown scenario id is flagged for rejection, not silently swapped', () => {
  const cfg = parseOgParams(sp({ scenario: 'bogus' }));
  assert.equal(cfg.scenarioUnknown, true);
  assert.equal(cfg.scenarioRequested, 'bogus');
});

test('#769 omitting the param is not an error', () => {
  const cfg = parseOgParams(sp({}));
  assert.equal(cfg.scenarioUnknown, false);
});
