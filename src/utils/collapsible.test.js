// Selector/ARIA contract for CollapsibleSection (#799).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionAttributes, toggleAriaAttributes } from './collapsible.js';

test('sectionAttributes exposes the canonical id anchor', () => {
  const attrs = sectionAttributes('snapshots');
  assert.equal(attrs.id, 'snapshots');
});

test('sectionAttributes keeps the legacy data-collapsible hook', () => {
  const attrs = sectionAttributes('localmaxxing');
  assert.equal(attrs['data-collapsible'], 'localmaxxing');
});

test('toggleAriaAttributes references the body only while it is mounted', () => {
  const open = toggleAriaAttributes('slo-budgets', true);
  assert.equal(open['aria-expanded'], true);
  assert.equal(open['aria-controls'], 'slo-budgets-body');

  const closed = toggleAriaAttributes('slo-budgets', false);
  assert.equal(closed['aria-expanded'], false);
  assert.ok(!('aria-controls' in closed), 'collapsed section must not dangle aria-controls at an unmounted id');
});
