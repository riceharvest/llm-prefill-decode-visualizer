// Shared playback-loop plumbing for the animated views (issues #457/#860/#862).
//
// requestAnimationFrame callbacks never fire in hidden/background tabs, so a
// simulation advanced exclusively inside a rAF chain freezes at its first
// frame forever when the tab is not visible — no error, no timeout, no
// completion signal. createFrameScheduler() wraps that loop with a wall-clock
// fallback: while the document is hidden it drives ticks from a plain timer,
// and on visibilitychange it migrates still-pending ticks between the two
// transports so an in-flight run keeps advancing (at coarse resolution) until
// the tab is visible again.
//
// Tick callbacks always receive a timestamp from the injectable now(), so the
// per-frame delta math in callers is identical regardless of which transport
// fired the tick.
//
// runStateFor() derives the machine-readable data-state sentinel (#862) so
// agents can await "complete" structurally instead of scraping button labels.

const DEFAULT_HIDDEN_TICK_MS = 200;

export function createFrameScheduler({
  requestFrame = typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : null,
  cancelFrame = typeof cancelAnimationFrame === 'function'
    ? (id) => cancelAnimationFrame(id)
    : null,
  setTimeout: scheduleTimeout = (cb, ms) => setTimeout(cb, ms),
  clearTimeout: cancelTimeout = (id) => clearTimeout(id),
  isHidden = () => (typeof document !== 'undefined' ? document.hidden : false),
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  hiddenTickMs = DEFAULT_HIDDEN_TICK_MS,
  // Test seam; defaults to wiring document visibilitychange below.
  onVisibilityChange = null
} = {}) {
  const pending = new Map(); // handle -> { cb, kind: 'frame'|'timer', raw }
  let nextHandle = 1;
  let detached = false;

  const fire = (handle) => {
    const entry = pending.get(handle);
    if (!entry || detached) return;
    pending.delete(handle);
    entry.cb(now());
  };

  const releaseRaw = (entry) => {
    if (entry.raw === null || entry.raw === undefined) return;
    if (entry.kind === 'frame') {
      if (cancelFrame) cancelFrame(entry.raw);
    } else {
      cancelTimeout(entry.raw);
    }
    entry.raw = null;
  };

  const scheduleVia = (handle, entry, kind) => {
    entry.kind = kind;
    if (kind === 'frame' && requestFrame) {
      entry.raw = requestFrame(() => fire(handle));
    } else {
      entry.raw = scheduleTimeout(() => fire(handle), hiddenTickMs);
    }
  };

  // Migrate every still-pending tick to whichever transport works in the
  // current visibility state. Called by the visibility watcher (and exposed
  // for environments/tests without DOM events).
  const migrate = () => {
    if (detached) return;
    const want = isHidden() ? 'timer' : 'frame';
    for (const [handle, entry] of pending) {
      if (entry.kind !== want) {
        releaseRaw(entry);
        scheduleVia(handle, entry, want);
      }
    }
  };

  let detachVisibility = null;
  if (typeof onVisibilityChange === 'function') {
    detachVisibility = onVisibilityChange(migrate);
  } else if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', migrate);
    detachVisibility = () => document.removeEventListener('visibilitychange', migrate);
  }

  return {
    // Schedule one tick; returns an opaque handle for cancel().
    request(cb) {
      const handle = nextHandle++;
      const entry = { cb, kind: null, raw: null };
      pending.set(handle, entry);
      scheduleVia(handle, entry, isHidden() ? 'timer' : 'frame');
      return handle;
    },
    cancel(handle) {
      const entry = pending.get(handle);
      if (!entry) return;
      releaseRaw(entry);
      pending.delete(handle);
    },
    // Re-evaluate transports for all pending ticks (no-op when unchanged).
    refresh: migrate,
    pendingCount() {
      return pending.size;
    },
    dispose() {
      detached = true;
      for (const [, entry] of pending) releaseRaw(entry);
      pending.clear();
      if (detachVisibility) detachVisibility();
    }
  };
}

// Machine-readable run-state sentinel (#862): the four animated views express
// progress only through volatile button labels and sr-only live text today.
// This maps each view's (playing / started / finished) signals onto one stable
// vocabulary for the root element's data-state attribute.
export function runStateFor({ isPlaying, hasStarted, hasFinished }) {
  if (isPlaying) return 'running';
  if (hasFinished) return 'complete';
  if (hasStarted) return 'paused';
  return 'idle';
}
