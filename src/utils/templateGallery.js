// Template gallery (issue #111) — one-click scenario cards that answer the
// questions newcomers actually ask. Each template pairs a fully-configured
// simulation (URL params passed through demoUrl(), same format as the
// FAQ_DEMOS deep-links in TheoryGuide.jsx) with a short theory blurb, so a
// curious visitor can go from question to a running, pre-configured sim in
// one click.
//
// Only locale-independent data lives here (ids, icons, demo configs). All
// user-facing copy — question, tagline, blurb, chips and the section chrome —
// lives in src/i18n/locales/<locale>/templates.json keyed by template id
// (#587: the gallery used to bypass i18n entirely and rendered hardcoded
// English inside the RTL Arabic locale).

export const TEMPLATE_GALLERY = [
  {
    id: 'agent-slow-turn5',
    icon: '🤖',
    demo: {
      tab: 'agentic', preset: 'rtx4090_exl2', prefill: 3800, decode: 105,
      turns: 8, sprompt: 4096, tool: 1024, thought: 256, cache: 0, sim: 20
    }
  },
  {
    id: 'prefix-caching-128k',
    icon: '📚',
    demo: {
      tab: 'agentic', preset: 'rtx4090_exl2', prefill: 3800, decode: 105,
      turns: 4, sprompt: 65536, tool: 4096, thought: 512, cache: 1, sim: 50
    }
  },
  {
    id: 'rpi5-7b',
    icon: '🍓',
    demo: {
      tab: 'single', preset: 'rpi5', prefill: 120, decode: 8,
      prompt: 2048, output: 256, sim: 'instant'
    }
  },
  {
    id: 'fp16-vs-int4-kv',
    icon: '💾',
    demo: {
      tab: 'kvcache', model: 'llama70b', ctx: 131072, prec: 2, batch: 1
    }
  }
];

export function templateById(id) {
  return TEMPLATE_GALLERY.find(t => t.id === id) || null;
}
