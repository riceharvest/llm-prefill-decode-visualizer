import { useEffect, useRef } from 'react';

/**
 * Accessibility helpers (issue #77): moving focus on tab switches and
 * trapping/restoring focus around modal dialogs (WAI-ARIA dialog pattern).
 */

/**
 * Move focus to the new panel's heading whenever `dep` (the active tab)
 * changes, so screen-reader and keyboard users land in the content they just
 * opened instead of being dumped back at the document top.

 * The first call is skipped: on initial page load focus must stay where the
 * browser put it. Tab panels mount lazily one render late, so the lookup is
 * retried over a few animation frames before giving up silently.

 * Panels opt in by marking their root heading with `data-panel-heading` and
 * `tabIndex={-1}`.
 */
export function useFocusPanelHeading(containerRef, dep, { enabled = true } = {}) {
  // Sentinel + prev-value comparison instead of a "first run" boolean:
  // React StrictMode mounts effects twice in development, so a boolean flag
  // would treat the second mount as a change and steal focus on page load.
  const INITIAL = useRef(typeof Symbol === 'function' ? Symbol('initial') : '@@initial');
  const prevDep = useRef(INITIAL.current);

  useEffect(() => {
    if (prevDep.current === INITIAL.current) {
      prevDep.current = dep; // first commit — never move focus
      return undefined;
    }
    if (!enabled || dep === prevDep.current) return undefined;
    prevDep.current = dep;

    let raf;
    const tryFocus = (attemptsLeft) => {
      const el = containerRef.current?.querySelector('[data-panel-heading]');
      if (el) {
        el.focus();
        return;
      }
      if (attemptsLeft > 0) {
        raf = requestAnimationFrame(() => tryFocus(attemptsLeft - 1));
      }
    };
    raf = requestAnimationFrame(() => tryFocus(10));
    return () => cancelAnimationFrame(raf);
  }, [containerRef, dep, enabled]);
}

/**
 * Trap-and-restore focus around a modal, per the WAI-ARIA dialog pattern.
 * While `active`: focus is moved into the container (to `focusSelector` when
 * given, else the container itself) and Tab/Shift+Tab cycle inside it.
 * On deactivate the previously focused element regains focus.
 */
export function useFocusTrap(containerRef, active, focusSelector = null) {
  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const initial = focusSelector ? container.querySelector(focusSelector) : null;
    const focusTarget = initial || container;
    if (focusTarget instanceof HTMLElement) focusTarget.focus();

    const FOCUSABLE = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(container.querySelectorAll(FOCUSABLE));
      if (focusable.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      const inside = current && container.contains(current);
      if (e.shiftKey && (current === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [containerRef, active, focusSelector]);
}
