// Hash-anchor navigation helper (issue #589).
//
// Deep links of the form ?tab=theory#theory-prefill previously only called
// scrollIntoView({behavior:'smooth'}) once on mount: the viewport moved but
// keyboard/screen-reader focus stayed at the top of the document, same-
// document hash edits did nothing (no hashchange listener anywhere), and the
// smooth animation raced headless screenshot timing.
//
// scrollToHashAnchor() scrolls AND moves focus onto the target (which must be
// reachable — callers give anchor targets tabIndex={-1}), uses 'auto'
// behavior when the user prefers reduced motion so no animation plays, and
// returns whether a target was found so tests can assert the contract.

export function prefersReducedMotion(win = typeof window !== 'undefined' ? window : undefined) {
  return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

/**
 * Scroll to `hash` ('#id' or bare 'id') and move focus onto the element.
 * Pass a document-like object to stay testable outside the browser.
 * Returns the focused element, or null when the hash is empty/unknown.
 */
export function scrollToHashAnchor(hash, doc = typeof document !== 'undefined' ? document : undefined) {
  if (!doc || !hash) return null;
  const id = String(hash).replace(/^#/, '');
  if (!id) return null;
  const el = doc.getElementById(id);
  if (!el) return null;

  // Wait a frame so freshly-mounted tab content is laid out before scrolling.
  const scroll = () => {
    el.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start'
    });
    // WCAG 2.4.3: after programmatic scrolling, focus must follow so the next
    // Tab press continues from the section, not the top of the page.
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(scroll);
  } else {
    scroll();
  }
  return el;
}
