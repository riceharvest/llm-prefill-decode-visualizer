// Machine-readable palette (#924).
//
// Chart/UI colors previously existed only as CSS custom properties in the
// hashed bundle, and /api/og hardcoded its own divergent palette — no
// surface exposed a color -> semantic-role mapping. This module is the
// single source of truth for the semantic colors; public/palette.json is a
// byte-mirror of it served statically so agents can fetch the mapping
// without parsing CSS. A test asserts both stay in sync with src/index.css.
//
// Keys are the CSS custom-property names from `:root` in src/index.css.

export const PALETTE = {
  // Backgrounds
  '--bg-app': '#0A0D11',
  '--bg-panel': '#10151B',
  '--bg-inset': '#0C1015',
  '--bg-raised': '#161C24',
  '--bg-hover': '#1B222C',

  // Text
  '--text-main': '#E6EAF0',
  '--text-muted': '#97A3B2',
  '--text-subtle': '#5E6A78',

  // Borders
  '--border': '#212B36',
  '--border-strong': '#31404F',
  '--border-focus': '#22D3EE',

  // Accent
  '--accent': '#22D3EE',
  '--accent-strong': '#67E8F9',
  '--accent-ink': '#06222A',

  // Phase colors (chart series)
  '--prefill': '#38BDF8',
  '--decode': '#34D399',
  '--agent': '#FBBF24',

  // Status
  '--danger': '#F87171',
  '--warn': '#F59E0B'
};

/** Semantic role labels for agents that want meaning, not just hex values. */
export const PALETTE_ROLES = {
  '--bg-app': 'app background',
  '--bg-panel': 'panel background',
  '--bg-inset': 'inset background',
  '--bg-raised': 'raised surface background',
  '--bg-hover': 'hover surface background',
  '--text-main': 'primary text',
  '--text-muted': 'secondary text',
  '--text-subtle': 'tertiary text',
  '--border': 'default border',
  '--border-strong': 'emphasized border',
  '--border-focus': 'focus ring',
  '--accent': 'primary accent',
  '--accent-strong': 'hover accent',
  '--accent-ink': 'text on accent',
  '--prefill': 'prefill phase chart color',
  '--decode': 'decode phase chart color',
  '--agent': 'agentic loop phase chart color',
  '--danger': 'danger/error status',
  '--warn': 'warning status'
};

export default PALETTE;
