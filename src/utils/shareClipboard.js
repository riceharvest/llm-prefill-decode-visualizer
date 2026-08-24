// Issue #726: the header Share button used to flip to a success ✓
// unconditionally because App.handleShare() swallowed clipboard errors inside
// a try/catch that resolved normally. Copying now reports whether it actually
// worked so UI feedback can tell the truth.

/**
 * Write text to the clipboard. Resolves to `true` only when the write
 * succeeded; resolves to `false` when the Clipboard API is unavailable or
 * rejects. Never throws.
 *
 * @param {string} text
 * @param {(text: string) => Promise<void>} [writeText] test seam — defaults to
 *   navigator.clipboard.writeText when available.
 * @returns {Promise<boolean>}
 */
export async function copyText(text, writeText) {
  let write = writeText;
  if (typeof write !== 'function' && typeof navigator !== 'undefined') {
    const clip = navigator.clipboard;
    write = clip && typeof clip.writeText === 'function'
      ? clip.writeText.bind(clip)
      : undefined;
  }
  if (typeof write !== 'function') return false;
  try {
    await write(text);
    return true;
  } catch {
    return false;
  }
}
