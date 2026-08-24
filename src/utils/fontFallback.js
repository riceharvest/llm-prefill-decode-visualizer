// Web-font failure signaling (#954): index.html pulls Inter + JetBrains Mono
// from fonts.googleapis.com, but document.fonts.status/check() report
// 'loaded'/true even when the network fetch fails, so offline or sandboxed
// agents silently measure ~34% narrower fallback mono metrics — and any
// exported PNG/SVG is rendered with fallback metrics too. The sentinel below
// measures REAL rendered widths of probe text set in the web stack vs the
// bare fallback family: identical width ⇒ the web font did not apply.
//
// The result is exposed two ways so headless runs can consume it:
//   - <html data-web-fonts="loaded|fallback|unknown"> attribute, and
//   - a single console.warn when fallback metrics are in effect.

export const FONT_PROBE_TEXT = 'mmmwww0000MMMMWWWW1111';

// One entry per web family actually used by index.html, paired with the
// bare fallback it would silently degrade to.
const PROBES = [
  { stack: '"JetBrains Mono", monospace', fallback: 'monospace' },
  { stack: 'Inter, sans-serif', fallback: 'sans-serif' }
];

/** Measure a span of probe text rendered in the given font-family. */
export function measureFontWidth(doc, fontFamily) {
  const el = doc.createElement('span');
  el.style.cssText =
    'position:absolute;left:-9999px;top:0;visibility:hidden;' +
    `white-space:pre;font-size:64px;font-family:${fontFamily};`;
  el.textContent = FONT_PROBE_TEXT;
  doc.body.appendChild(el);
  const width = el.getBoundingClientRect().width;
  el.remove();
  return width;
}

/**
 * Pure decision: a web stack counts as applied only when its rendered width
 * differs from the bare fallback's (0.5px tolerance for rounding noise).
 */
export function fontStackApplied(widthOfStack, widthOfFallback) {
  return Number.isFinite(widthOfStack) && Number.isFinite(widthOfFallback) &&
    Math.abs(widthOfStack - widthOfFallback) > 0.5;
}

/**
 * Detect whether at least one web font is really applied. Returns
 * 'loaded' | 'fallback', or 'unknown' when there is no DOM to measure in.
 */
export function detectWebFonts(doc) {
  if (!doc || !doc.body) return 'unknown';
  for (const probe of PROBES) {
    if (fontStackApplied(
      measureFontWidth(doc, probe.stack),
      measureFontWidth(doc, probe.fallback)
    )) {
      return 'loaded';
    }
  }
  return 'fallback';
}

function applySentinel(doc, log) {
  const state = detectWebFonts(doc);
  doc.documentElement.setAttribute('data-web-fonts', state);
  if (state === 'fallback') {
    log.warn(
      '[fonts] Web fonts (Inter / JetBrains Mono) unreachable or not applied — ' +
      'text metrics are fallback values; exported PNG/SVG measurements will differ.'
    );
  }
  return state;
}

/**
 * Install the one-shot sentinel. Waits for document.fonts.ready first so an
 * online slow load isn't misreported as fallback; ready resolves even when
 * loading failed. Returns 'unknown' immediately when measurement must be
 * deferred; the attribute/warn land once fonts settle.
 */
export function installFontSentinel(
  doc = (typeof window !== 'undefined' ? window.document : null),
  log = console
) {
  if (!doc) return 'unknown';
  if (doc.fonts?.ready?.then) {
    doc.fonts.ready.then(() => applySentinel(doc, log));
    return 'pending';
  }
  return applySentinel(doc, log);
}
