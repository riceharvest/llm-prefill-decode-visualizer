import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  noteStorageFailure,
  noteStorageSuccess,
  storageStatus,
  resetStorageHealth,
  STORAGE_KEYS
} from './storageHealth.js';
import { saveSloBudgets, loadSloBudgets, SLO_STORAGE_KEY } from './slo.js';

function throwingStorage() {
  return {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('quota exceeded'); }
  };
}

test('#779 saveSloBudgets failure is visible via storageStatus()', () => {
  resetStorageHealth();
  const ok = saveSloBudgets({ ttftMs: 400 }, throwingStorage());
  assert.equal(ok, false);
  const status = storageStatus();
  assert.equal(status.available, false);
  assert.equal(status.failedKey, SLO_STORAGE_KEY);
});

test('#779 successful write clears the failure signal', () => {
  resetStorageHealth();
  const backing = new Map();
  const good = {
    getItem: k => backing.has(k) ? backing.get(k) : null,
    setItem: (k, v) => backing.set(k, v)
  };
  saveSloBudgets({ ttftMs: 250, tpotMs: 40 }, throwingStorage());
  assert.equal(storageStatus().available, false);
  assert.equal(saveSloBudgets({ ttftMs: 250, tpotMs: 40 }, good), true);
  assert.deepEqual(storageStatus(), { available: true, failedKey: null });
});

test('#779 loadSloBudgets falls back to defaults when storage throws', () => {
  resetStorageHealth();
  const budgets = loadSloBudgets(throwingStorage());
  assert.equal(budgets.ttetfMs, undefined); // sanity: no invented fields
  assert.ok(Number.isFinite(budgets.tpotMs));
});

test('noteStorageFailure records the failing key', () => {
  resetStorageHealth();
  noteStorageFailure(STORAGE_KEYS.curriculumProgress);
  assert.equal(storageStatus().failedKey, 'llmpd-curriculum-progress');
});
