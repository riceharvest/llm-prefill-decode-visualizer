import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANNOUNCE_MIN_INTERVAL_MS,
  createLiveAnnouncer,
  buildPrefillAnnouncement,
  buildDecodeAnnouncement,
  buildDoneAnnouncement,
  buildTurnAnnouncement,
  buildAgenticDoneAnnouncement
} from './liveAnnouncer.js';

test('first announcement always passes the throttle', () => {
  const a = createLiveAnnouncer();
  assert.equal(a.announce('Prefilling 2,048 tokens…', { now: 0 }), 'Prefilling 2,048 tokens…');
});

test('intermediate announcements are throttled within the interval', () => {
  const a = createLiveAnnouncer();
  assert.equal(a.announce('Turn 1 of 20: prefilling…', { now: 0 }), 'Turn 1 of 20: prefilling…');
  assert.equal(a.announce('Turn 1 of 20: decoding…', { now: 1000 }), null);
  assert.equal(a.announce('Turn 2 of 20: prefilling…', { now: ANNOUNCE_MIN_INTERVAL_MS - 1 }), null);
  assert.equal(a.announce('Turn 2 of 20: prefilling…', { now: ANNOUNCE_MIN_INTERVAL_MS }), 'Turn 2 of 20: prefilling…');
});

test('identical consecutive messages are suppressed even past the interval', () => {
  const a = createLiveAnnouncer();
  assert.equal(a.announce('Decoding…', { now: 0 }), 'Decoding…');
  assert.equal(a.announce('Decoding…', { now: ANNOUNCE_MIN_INTERVAL_MS * 10 }), null);
});

test('force bypasses both throttle and duplicate suppression (final summary)', () => {
  const a = createLiveAnnouncer();
  const done = buildDoneAnnouncement({ ttftSec: 0.4, tpotMs: 18, totalSec: 9.2 });
  assert.equal(a.announce(done, { now: 0, force: true }), done);
  // A forced message also updates the throttle clock…
  assert.equal(a.announce('Decoding…', { now: 1 }), null);
  // …and a second identical forced summary still announces.
  assert.equal(a.announce(done, { now: 10, force: true }), done);
});

test('empty messages never announce', () => {
  const a = createLiveAnnouncer();
  assert.equal(a.announce('', { now: 0, force: true }), null);
});

test('reset clears throttle and duplicate state', () => {
  const a = createLiveAnnouncer();
  a.announce('Decoding…', { now: 0 });
  a.reset();
  assert.equal(a.announce('Decoding…', { now: 1 }), 'Decoding…');
});

test('message builders produce the issue-shaped strings', () => {
  assert.equal(buildPrefillAnnouncement(2048), 'Prefilling 2,048 tokens…');
  assert.equal(buildDecodeAnnouncement(), 'Decoding…');
  assert.match(
    buildDoneAnnouncement({ ttftSec: 0.4, tpotMs: 18, totalSec: 9.2 }),
    /^Done: TTFT .+, TPOT 18 ms, total .+$/
  );
  assert.equal(buildTurnAnnouncement({ turn: 3, turns: 12, phase: 'decoding' }), 'Turn 3 of 12: decoding…');
  assert.equal(buildTurnAnnouncement({ turn: 1, turns: 12, phase: 'prefilling' }), 'Turn 1 of 12: prefilling…');
  assert.match(
    buildAgenticDoneAnnouncement({ turns: 4, ttftSec: 0.5, tpotMs: 18, totalSec: 30 }),
    /^Done: 4 turns, TTFT .+, TPOT 18 ms, total .+$/
  );
});
