// Pure helpers behind App.jsx's global keyboard shortcuts.
// Extracted so the guards are unit-testable without React (#810/#814/#816/#822).

// Elements where the user types or picks values: global plain-key AND
// Ctrl/Cmd+Z shortcuts must yield to native editing behavior there (#814).
export function isTypingContext(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return el.isContentEditable === true;
}

const INTERACTIVE_TAGS = new Set(['BUTTON', 'A']);

// Elements that activate on plain keys (Enter/Space) or carry their own
// key semantics: R / 0-9 / ? must not fire while one of these holds focus
// just because it isn't a form field (#816).
export function isInteractiveContext(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'BODY' || tag === 'HTML') return false;
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  return role === 'radio' || role === 'option' || role === 'menuitem' || role === 'tab';
}

// Digits map to tabs 1-based ('1' → tabs[0]). Out-of-range digits — including
// '0' when the app has fewer than 10 views — resolve to null instead of an
// undefined tab that blanks the whole content area (#822).
export function tabForDigit(digit, tabs) {
  const n = Number(digit);
  if (!Number.isInteger(n) || n < 1 || n > tabs.length) return null;
  return tabs[n - 1];
}
