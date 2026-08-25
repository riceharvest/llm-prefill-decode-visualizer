// Tap-to-reveal tooltips on touch devices (#85 / #64).
//
// Desktop tooltips are pure CSS (`[data-tooltip]:hover::after`), which has no
// equivalent on touch screens where there is no hover. This module installs a
// single capture-phase click listener on coarse-pointer devices that toggles a
// `.tooltip-open` class on tapped `[data-tooltip]` elements; the matching CSS
// reveals the bubble. Tapping anywhere else dismisses open bubbles.
//
// Issue #985: the capability check used to run exactly once at App mount, so a
// device whose pointer mode flips later (tablet docking/undocking, rotation
// into a hover-less state, device emulation attached mid-session) never got
// the fallback. The media query is now watched for changes and the install
// retried when it starts matching.

const TOUCH_QUERY = '(hover: none), (pointer: coarse)';

let installed = false;
let watching = false;

export function isTouchDevice() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(TOUCH_QUERY).matches;
}

function installClickListener() {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-tooltip]')
      : null;

    document.querySelectorAll('[data-tooltip].tooltip-open').forEach((node) => {
      if (node !== target) node.classList.remove('tooltip-open');
    });

    if (target) target.classList.toggle('tooltip-open');
  }, true);
}

export function installTouchTooltips() {
  if (installed) return;

  if (isTouchDevice()) {
    installed = true;
    installClickListener();
    return;
  }

  // Not a touch device (yet): watch the media query so late flips still get
  // the tap-to-reveal fallback instead of a one-shot-at-mount decision.
  if (!watching && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia(TOUCH_QUERY);
    if (typeof mq.addEventListener === 'function') {
      watching = true;
      mq.addEventListener('change', () => {
        installTouchTooltips();
      });
    }
  }
}

// Test hook: reset module-level idempotence guards between cases.
export function __resetTouchTooltipsForTests() {
  installed = false;
  watching = false;
}
