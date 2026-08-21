// Tap-to-reveal tooltips on touch devices (#85 / #64).
//
// Desktop tooltips are pure CSS (`[data-tooltip]:hover::after`), which has no
// equivalent on touch screens where there is no hover. This module installs a
// single capture-phase click listener on coarse-pointer devices that toggles a
// `.tooltip-open` class on tapped `[data-tooltip]` elements; the matching CSS
// reveals the bubble. Tapping anywhere else dismisses open bubbles.

let installed = false;

export function isTouchDevice() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

export function installTouchTooltips() {
  if (installed || !isTouchDevice()) return;
  installed = true;

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
