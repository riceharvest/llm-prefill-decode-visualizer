// FAQ Try-it demo deep-links, keyed by stable id (issue #588).
//
// These used to live as an array in TheoryGuide.jsx aligned with the
// `theory.faq` entries in src/i18n/locales/en/theory.json ONLY by array
// index — inserting/removing/reordering one FAQ entry silently re-pointed
// every later Try-it button at the wrong scenario, and a translated faq
// array of different length/order would produce language-dependent wrong
// links.
//
// Each entry in en/theory.json's faq array now carries a stable "id", and
// this map keys the demo params by that id. A drift test
// (src/utils/faqDemos.test.js) fails when an id here has no matching faq
// entry or vice versa.
export const FAQ_DEMOS = {
  'first-token-slow': { tab: 'single', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, prompt: 8192, output: 256, sim: 5 },
  'good-toks': { tab: 'compare', hwA: 'rtx3060_entry', hwB: 'rtx4090_exl2', cp: 4096, co: 512 },
  'decode-vs-prefill': { tab: 'single', preset: 'rtx3060_entry', prefill: 920, decode: 32, prompt: 4096, output: 2048, sim: 20 },
  'vram-needed': { tab: 'kvcache', model: 'llama70b', ctx: 32768, prec: 2 },
  'context-oom': { tab: 'kvcache', model: 'llama70b', ctx: 131072, prec: 2 },
  'flash-attention': { tab: 'agentic', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, turns: 6, sprompt: 4096, tool: 1024, thought: 256, sim: 20 },
  'quant-speed': { tab: 'compare', hwA: 'rtx4090_exl2', hwB: 'dual_rtx3090', cp: 8192, co: 1024 },
  'mac-cpu-bandwidth': { tab: 'compare', hwA: 'mac_ultra', hwB: 'rtx4090_exl2', cp: 8192, co: 512 }
};
