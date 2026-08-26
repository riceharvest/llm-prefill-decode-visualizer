import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameScheduler, runStateFor } from './playback.js';

// Fake rAF that captures callbacks without ever firing them — models a
// hidden/background tab where the compositor stops scheduling frames.
function makeFakeRaf() {
  const cbs = new Map();
  let nextId = 1;
  return {
    request(cb) {
      const id = nextId++;
      cbs.set(id, cb);
      return id;
    },
    cancel(id) { cbs.delete(id); },
    fireAll(now) {
      const snapshot = [...cbs.values()];
      cbs.clear();
      for (const cb of snapshot) cb(now);
    },
    get size() { return cbs.size; }
  };
}

// Fake timer registry so tests control exactly when timeouts run.
function makeFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    schedule(cb, ms) {
      const id = nextId++;
      timers.set(id, { cb, ms });
      return id;
    },
    cancel(id) { timers.delete(id); },
    fireAll() {
      const snapshot = [...timers.values()].map(t => t.cb);
      timers.clear();
      for (const cb of snapshot) cb();
    },
    get size() { return timers.size; }
  };
}

test('visible tab: ticks are scheduled on requestAnimationFrame with now() timestamps', () => {
  const raf = makeFakeRaf();
  const timers = makeFakeTimers();
  const scheduler = createFrameScheduler({
    requestFrame: raf.request,
    cancelFrame: raf.cancel,
    setTimeout: timers.schedule,
    clearTimeout: timers.cancel,
    isHidden: () => false,
    now: () => 1234
  });

  const seen = [];
  scheduler.request(t => seen.push(t));
  assert.equal(raf.size, 1);
  assert.equal(timers.size, 0);

  raf.fireAll(1234);
  assert.deepEqual(seen, [1234]);
  scheduler.dispose();
});

test('hidden tab (#860): ticks fall back to wall-clock timers, no raf consumed', () => {
  const raf = makeFakeRaf();
  const timers = makeFakeTimers();
  const scheduler = createFrameScheduler({
    requestFrame: raf.request,
    cancelFrame: raf.cancel,
    setTimeout: timers.schedule,
    clearTimeout: timers.cancel,
    isHidden: () => true,
    now: () => 5000
  });

  const seen = [];
  scheduler.request(t => seen.push(t));
  // The #860 freeze signature: zero frames available. The fallback must not
  // depend on any frame firing.
  assert.equal(raf.size, 0);
  assert.equal(timers.size, 1);

  timers.fireAll();
  assert.deepEqual(seen, [5000]);
  scheduler.dispose();
});

test('#860 regression: visible start then tab hides mid-run migrates the pending tick to a timer', () => {
  const raf = makeFakeRaf();
  const timers = makeFakeTimers();
  let hidden = false;
  let notify;
  const scheduler = createFrameScheduler({
    requestFrame: raf.request,
    cancelFrame: raf.cancel,
    setTimeout: timers.schedule,
    clearTimeout: timers.cancel,
    isHidden: () => hidden,
    now: () => 9000,
    onVisibilityChange: (fn) => { notify = fn; }
  });

  const seen = [];
  scheduler.request(t => seen.push(t));
  assert.equal(raf.size, 1);

  // Tab goes hidden; the pending raf would never fire in a real browser.
  hidden = true;
  notify();
  assert.equal(raf.size, 0, 'pending frame callback must be cancelled');
  assert.equal(timers.size, 1, 'tick must be re-armed on a timer');

  // Frames never fire, yet playback keeps advancing.
  timers.fireAll();
  assert.deepEqual(seen, [9000]);
  scheduler.dispose();
});

test('tab becomes visible again mid-run: pending timer migrates back to raf', () => {
  const raf = makeFakeRaf();
  const timers = makeFakeTimers();
  let hidden = true;
  let notify;
  const scheduler = createFrameScheduler({
    requestFrame: raf.request,
    cancelFrame: raf.cancel,
    setTimeout: timers.schedule,
    clearTimeout: timers.cancel,
    isHidden: () => hidden,
    now: () => 1,
    onVisibilityChange: (fn) => { notify = fn; }
  });

  let fired = 0;
  scheduler.request(() => fired++);
  assert.equal(timers.size, 1);

  hidden = false;
  notify();
  assert.equal(timers.size, 0, 'stale timer must be cancelled');
  assert.equal(raf.size, 1, 'tick must be re-armed on raf');

  // Timer firing after migration must not double-fire.
  timers.fireAll();
  assert.equal(fired, 0);
  raf.fireAll(1);
  assert.equal(fired, 1);
  scheduler.dispose();
});

test('cancel prevents a pending tick from firing on either transport', () => {
  const raf = makeFakeRaf();
  const timers = makeFakeTimers();
  const scheduler = createFrameScheduler({
    requestFrame: raf.request,
    cancelFrame: raf.cancel,
    setTimeout: timers.schedule,
    clearTimeout: timers.cancel,
    isHidden: () => false,
    now: () => 0
  });

  let fired = 0;
  const h1 = scheduler.request(() => fired++);
  scheduler.cancel(h1);
  raf.fireAll(0);
  assert.equal(fired, 0);

  const h2 = scheduler.request(() => fired++);
  scheduler.cancel(h2);
  timers.fireAll();
  assert.equal(fired, 0);
  assert.equal(scheduler.pendingCount(), 0);
  scheduler.dispose();
});

test('refresh(): multiple concurrent ticks all migrate together', () => {
  const raf = makeFakeRaf();
  const timers = makeFakeTimers();
  let hidden = false;
  const scheduler = createFrameScheduler({
    requestFrame: raf.request,
    cancelFrame: raf.cancel,
    setTimeout: timers.schedule,
    clearTimeout: timers.cancel,
    isHidden: () => hidden,
    now: () => 2
  });

  const seen = [];
  scheduler.request(t => seen.push(['a', t]));
  scheduler.request(t => seen.push(['b', t]));
  assert.equal(scheduler.pendingCount(), 2);

  hidden = true;
  scheduler.refresh();
  assert.equal(raf.size, 0);
  assert.equal(timers.size, 2);
  timers.fireAll();
  assert.equal(seen.length, 2);
  scheduler.dispose();
});

test('#862: runStateFor maps (playing, started, finished) onto the stable sentinel vocabulary', () => {
  assert.equal(runStateFor({ isPlaying: true, hasStarted: false, hasFinished: false }), 'running');
  assert.equal(runStateFor({ isPlaying: true, hasStarted: true, hasFinished: false }), 'running');
  // Finished wins over started when paused at the end of a run…
  assert.equal(runStateFor({ isPlaying: false, hasStarted: true, hasFinished: true }), 'complete');
  // …but playing beats finished only while actually replaying (isPlaying checked first).
  assert.equal(runStateFor({ isPlaying: true, hasStarted: true, hasFinished: true }), 'running');
  // Mid-run pause: progress exists but neither idle nor complete.
  assert.equal(runStateFor({ isPlaying: false, hasStarted: true, hasFinished: false }), 'paused');
  assert.equal(runStateFor({ isPlaying: false, hasStarted: false, hasFinished: false }), 'idle');
});
