import { test } from 'node:test';
import assert from 'node:assert/strict';

// urlState reads share-link params off window.location.search; stub a minimal
// window so the module is testable under node --test.
function withSearch(search, fn) {
  globalThis.window = { location: { search } };
  try {
    fn();
  } finally {
    delete globalThis.window;
  }
}

const { readParamNum, readSimSpeed, clampNum, readParamBool } = await import('./urlState.js');

test('readParamNum returns fallback for missing/empty/malformed values', () => {
  withSearch('?a=5', () => {
    assert.equal(readParamNum('missing', 7), 7);
    assert.equal(readParamNum('a', 7), 5);
  });
  withSearch('?b=', () => {
    assert.equal(readParamNum('b', 3), 3);
  });
  withSearch('?c=abc', () => {
    assert.equal(readParamNum('c', 9), 9);
  });
});

test('readParamNum clamps out-of-range values to [min, max] (#1059 #1078)', () => {
  withSearch('?n=99999999', () => {
    assert.equal(readParamNum('n', 12, 2, 48), 48);
  });
  withSearch('?n=-5', () => {
    assert.equal(readParamNum('n', 12, 1, 32), 1);
  });
  withSearch('?n=0', () => {
    assert.equal(readParamNum('n', 12, 1, 32), 1);
  });
  withSearch('?n=16', () => {
    assert.equal(readParamNum('n', 12, 1, 32), 16);
  });
});

test('readParamNum without bounds behaves exactly as before (non-breaking)', () => {
  withSearch('?x=-42.5&y=1e3', () => {
    assert.equal(readParamNum('x', 0), -42.5);
    assert.equal(readParamNum('y', 0), 1000);
  });
});

test('readSimSpeed accepts instant and positive multipliers', () => {
  withSearch('?sim=instant', () => {
    assert.equal(readSimSpeed(), 'instant');
  });
  withSearch('?sim=4', () => {
    assert.equal(readSimSpeed(), 4);
  });
  withSearch('', () => {
    assert.equal(readSimSpeed(), 1);
  });
});

test('readSimSpeed rejects non-positive and malformed values as 1x (#1039 #1040)', () => {
  for (const q of ['?sim=0', '?sim=-5', '?sim=abc', '?sim=NaN']) {
    withSearch(q, () => {
      assert.equal(readSimSpeed(), 1, `query ${q}`);
    });
  }
});

test('clampNum leaves values untouched when bounds are undefined', () => {
  assert.equal(clampNum(-10), -10);
  assert.equal(clampNum(5, 1), 5);
  assert.equal(clampNum(5, undefined, 3), 3);
  assert.equal(clampNum(2, 1, 3), 2);
});

test('readParamBool unchanged contract still holds alongside new helpers', () => {
  withSearch('?on=1&off=true&nope=0', () => {
    assert.equal(readParamBool('on', false), true);
    assert.equal(readParamBool('off', false), true);
    assert.equal(readParamBool('nope', true), false);
    assert.equal(readParamBool('absent', true), true);
  });
});
