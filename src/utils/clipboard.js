// Shared clipboard write helper (#1034).
//
// `navigator.clipboard.writeText` is unavailable or rejects in headless
// browsers, insecure (http) origins, and cross-origin iframes — exactly where
// agents and embedders operate. Before this helper existed only ONE of the
// app's copy paths (Copy MD) had an execCommand fallback, and that fallback
// itself lacked `readOnly`, raced user activation, and discarded its failure
// boolean. Every other path (Share, Embed snippet, EmbedDialog, Compare
// snippets, Snapshot link) failed silently.
//
// All copy paths now funnel through here:
//   1. Try the async Clipboard API.
//   2. Fall back to a hidden readOnly `<textarea>` + document.execCommand('copy')
//      inside the same task (user activation is still fresh).
//   3. Never throw — resolve `true` only when a copy actually succeeded.

/**
 * Copy `text` to the system clipboard. Resolves `true` on success, `false`
 * when every strategy failed. Never rejects.
 */
export async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied, insecure context, iframe without allow="clipboard-write"…
      // fall through to the legacy path while activation is still fresh.
    }
  }
  return execCommandCopy(text);
}

/**
 * Legacy hidden-textarea fallback. Returns the boolean result of
 * document.execCommand('copy') instead of discarding it, marks the textarea
 * readOnly so touch devices don't pop the keyboard, and restores whatever
 * selection the user had before the temporary select() clobbered it.
 */
export function execCommandCopy(text) {
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = String(text ?? '');
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);

    // Preserve the user's selection across the temporary select().
    const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
    const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    ta.select();
    ta.setSelectionRange(0, ta.value.length);

    let ok = false;
    try {
      ok = document.execCommand('copy') === true;
    } catch {
      ok = false;
    }

    ta.remove();

    if (saved && selection) {
      selection.removeAllRanges();
      selection.addRange(saved);
    }
    return ok;
  } catch {
    return false;
  }
}
