// Window-message contract for /embed iframes (issue #894).
//
// The embeddable surface used to be a one-way URL-param snapshot player: no
// postMessage in either direction, so a cross-origin host page could not drive
// playback or observe state. This module defines the minimal typed contract:
//
//   frame → parent   { type: 'llmpdv:ready',  tab }        on mount
//                    { type: 'llmpdv:state', tab, playing }  on state change
//   parent → frame   { type: 'llmpdv:command', action: 'play' | 'pause'
//                      | 'reset' | 'setTab', tab? }
//
// Commands are only accepted from the DIRECT parent window (event.source
// check) — messages from any other origin/window are ignored. Pure helpers
// here; EmbedApp.jsx installs them.

export const EMBED_COMMAND_TYPE = 'llmpdv:command';
export const EMBED_EVENTS = {
  READY: 'llmpdv:ready',
  STATE: 'llmpdv:state'
};
export const EMBED_COMMAND_ACTIONS = ['play', 'pause', 'reset', 'setTab'];

/** Build a postMessage payload for an outbound embed event. */
export function embedEvent(type, payload = {}) {
  return { type, ...payload };
}

/**
 * Validate raw message data as an embed command.
 * Returns { action, tab } or null. `setTab` requires a string `tab`.
 */
export function isEmbedCommand(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type !== EMBED_COMMAND_TYPE) return null;
  if (typeof data.action !== 'string' || !EMBED_COMMAND_ACTIONS.includes(data.action)) return null;
  if (data.action === 'setTab' && typeof data.tab !== 'string') return null;
  return { action: data.action, tab: data.tab ?? null };
}

/**
 * Extract an embed command from a MessageEvent-like object, but only when it
 * originates from `parent` (the embedding window). Returns { action, tab } or
 * null. Pass parent explicitly so this stays testable outside a browser.
 */
export function parseEmbedCommand(event, parent) {
  if (!event || !parent || event.source !== parent) return null;
  return isEmbedCommand(event.data);
}

/**
 * Post an embed event to the parent window. Returns true when delivered.
 * Never posts to the current window itself and never throws (postMessage to a
 * detached frame can raise synchronously in some engines).
 */
export function postEmbedEvent(targetWin, type, payload = {}) {
  const self = typeof window !== 'undefined' ? window : null;
  if (!targetWin || targetWin === self || typeof targetWin.postMessage !== 'function') return false;
  try {
    targetWin.postMessage(embedEvent(type, payload), '*');
    return true;
  } catch {
    return false;
  }
}

/**
 * Install the command listener for the embedded frame. Only messages whose
 * source is the direct parent are accepted. Returns a cleanup function.
 */
export function installEmbedBridge({ parent, onCommand } = {}) {
  const hasWindow = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (!hasWindow || typeof onCommand !== 'function' || !parent) return () => {};
  const handler = (event) => {
    const cmd = parseEmbedCommand(event, parent);
    if (cmd) onCommand(cmd);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
