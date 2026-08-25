import { useEffect, useMemo, useState } from 'react'
import { parseComparePath, prettifySlug, slugify } from '../utils/compareSlug.js'
import { collectGroupedItems, dedupeByKey } from '../utils/benchmarksIndex'

// SEO comparison page for /compare/:a-vs-:b (rewritten to compare.html by
// vercel.json). Numbers come live from /api/benchmarks?groupBy=hardware so
// every indexed pair always renders current community data — no per-pair
// build step needed. Pagination is followed until has_more=false (#772) so a
// hardware-count growth spurt past one 200-row page can't silently drop
// slower rigs into "No measured runs yet" holes on indexed pages.

function fmt(n) {
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—'
}

function labelOf(group) {
  return group?.bestRun?.hardware || group?.key || ''
}

function findBySlug(groups, slug) {
  if (!slug) return null
  return groups.find(g => slugify(labelOf(g)) === slug) || null
}

function useDocumentMeta(title, description) {
  useEffect(() => {
    if (!title) return
    document.title = title
    const desc = document.querySelector('meta[name="description"]')
    if (desc && description) desc.setAttribute('content', description)
  }, [title, description])
}

function StatCard({ title, testId, children }) {
  return (
    <div data-testid={testId} style={{
      flex: '1 1 260px',
      border: '1px solid var(--border, #2a2f3a)',
      borderRadius: 12,
      padding: '16px 18px',
      background: 'var(--panel, #161a22)',
    }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.7, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

export default function ComparePage() {
  const parsed = useMemo(() => parseComparePath(window.location.pathname), [])
  const [groups, setGroups] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!parsed) return
    const controller = new AbortController()
    const fetchPage = async (query) => {
      const res = await fetch(`/api/benchmarks?${query}`, { signal: controller.signal })
      if (!res.ok) throw new Error(`/api/benchmarks returned ${res.status}`)
      return res.json()
    }
    collectGroupedItems(fetchPage, { groupBy: 'hardware', limit: 200 })
      .then(({ items }) => setGroups(dedupeByKey(items)))
      .catch(err => {
        if (err.name !== 'AbortError') setError(err.message)
      })
    return () => controller.abort()
  }, [parsed])

  const a = parsed ? findBySlug(groups, parsed.a) : null
  const b = parsed ? findBySlug(groups, parsed.b) : null

  const nameA = a ? labelOf(a) : prettifySlug(parsed?.a)
  const nameB = b ? labelOf(b) : prettifySlug(parsed?.b)

  useDocumentMeta(
    `${nameA} vs ${nameB} LLM inference speed — tok/s compared | LLM Prefill & Decode Visualizer`,
    `${nameA} vs ${nameB}: community-measured LLM prefill and decode tok/s, median + 95% CI. Which is faster for local LLM inference?`,
  )

  // Internal linking for crawlers: pairwise links across the top hardware by
  // median decode speed.
  const moreComparisons = useMemo(() => {
    if (!Array.isArray(groups)) return []
    const top = [...groups].sort((x, y) => (y.decode?.median || 0) - (x.decode?.median || 0)).slice(0, 8)
    const links = []
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        links.push({ sa: slugify(labelOf(top[i])), sb: slugify(labelOf(top[j])), na: labelOf(top[i]), nb: labelOf(top[j]) })
      }
    }
    return links
  }, [groups])

  if (!parsed) {
    return (
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '48px 20px' }} data-testid="compare-page">
        <h1>Hardware comparison</h1>
        <p>This page compares two hardware setups, e.g. <code>/compare/rtx-3090-vs-rtx-4090</code>.</p>
        <p><a href="/">Open the LLM Prefill &amp; Decode Visualizer →</a></p>
      </main>
    )
  }

  const loaded = Array.isArray(groups)
  const winner = loaded && a && b
    ? ((a.decode?.median ?? 0) >= (b.decode?.median ?? 0) ? { side: 'a', g: a } : { side: 'b', g: b })
    : null
  const loser = winner ? (winner.side === 'a' ? b : a) : null
  // Overlapping 95% bootstrap CIs = statistically tied (API's stated reading).
  const tied = loaded && a && b &&
    a.decode?.ci95 && b.decode?.ci95 &&
    a.decode.ci95.lo <= b.decode.ci95.hi && b.decode.ci95.lo <= a.decode.ci95.hi

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px 64px', fontFamily: 'Inter, system-ui, sans-serif' }} data-testid="compare-page">
      <p style={{ marginBottom: 4 }}><a href="/">← LLM Prefill &amp; Decode Visualizer</a></p>
      <h1 style={{ fontSize: 'clamp(24px, 4vw, 34px)', lineHeight: 1.2 }}>
        {nameA} vs {nameB}: LLM inference speed
      </h1>
      <p style={{ opacity: 0.85 }}>
        Community-measured tokens/sec (batch&nbsp;1), median over all runs with a 95% bootstrap
        confidence interval. Live from the benchmark database{loaded ? ` · ${groups.length} hardware groups` : ''}.
      </p>

      {error && (
        <p role="alert" data-testid="compare-error" style={{ color: '#f87171' }}>Could not load benchmarks ({error}). Try refreshing.</p>
      )}
      {!loaded && !error && <p data-testid="compare-loading">Loading live benchmark data…</p>}
      {loaded && (!a || !b) && (
        <>
          <p role="alert" data-testid="compare-not-found" style={{ color: '#fbbf24' }}>
            No measured runs yet for {!a ? `"${nameA}"` : `"${nameB}"`}. Comparisons are generated for hardware in the
            benchmark database — check the spelling or browse the visualizer.
          </p>
          <p><a href="/">Browse measured hardware →</a></p>
        </>
      )}

      {loaded && a && b && (
        <>
          {tied
            ? (
              <div data-testid="compare-verdict" style={{
                border: '1px solid #f59e0b55', background: '#f59e0b18', borderRadius: 12,
                padding: '14px 16px', margin: '20px 0',
              }}>
                <strong>Statistically tied.</strong> Their 95% confidence intervals overlap — the data can't
                separate them yet. More runs would tighten the intervals.
              </div>
            )
            : winner && (
              <div data-testid="compare-verdict" style={{
                border: '1px solid #10b98155', background: '#10b98118', borderRadius: 12,
                padding: '14px 16px', margin: '20px 0',
              }}>
                <strong>{winner.side === 'a' ? nameA : nameB}</strong> decodes{' '}
                <strong>{fmt(winner.g.decode.median)} tok/s</strong> vs {fmt(loser.decode.median)} tok/s —{' '}
                {(winner.g.decode.median / Math.max(1, loser.decode.median)).toFixed(2)}× faster at output generation
                (median, batch 1).
              </div>
            )}

          <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 24 }} data-testid="compare-stats">
            {[{ name: nameA, g: a, tid: 'compare-card-a' }, { name: nameB, g: b, tid: 'compare-card-b' }].map(({ name, g, tid }) => (
              <StatCard key={name} title={name} testId={tid}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '6px 0', opacity: 0.75 }}>Decode (out)</td>
                      <td style={{ textAlign: 'right', fontFamily: '"JetBrains Mono", monospace' }}>
                        {fmt(g.decode?.median)} tok/s
                        {g.decode?.ci95 && <span style={{ opacity: 0.65, fontSize: 12 }}> [{fmt(g.decode.ci95.lo)}–{fmt(g.decode.ci95.hi)}]</span>}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '6px 0', opacity: 0.75 }}>Prefill (in)</td>
                      <td style={{ textAlign: 'right', fontFamily: '"JetBrains Mono", monospace' }}>
                        {fmt(g.prefill?.median)} tok/s
                        {g.prefill?.ci95 && <span style={{ opacity: 0.65, fontSize: 12 }}> [{fmt(g.prefill.ci95.lo)}–{fmt(g.prefill.ci95.hi)}]</span>}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '6px 0', opacity: 0.75 }}>Measured runs</td>
                      <td style={{ textAlign: 'right' }}>{g.runs}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '6px 0', opacity: 0.75 }}>Confidence</td>
                      <td style={{ textAlign: 'right' }}>{Number.isFinite(g.confidence?.score) ? `${g.confidence.score}/100` : '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '6px 0', opacity: 0.75 }}>Newest run</td>
                      <td style={{ textAlign: 'right' }}>{g.freshness?.newestRunAt ? new Date(g.freshness.newestRunAt).toISOString().slice(0, 10) : '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </StatCard>
            ))}
          </section>

          <h2 style={{ fontSize: 20, marginTop: 32 }}>How to read this comparison</h2>
          <ul style={{ lineHeight: 1.6, paddingLeft: 20 }}>
            <li><strong>Decode tok/s</strong> is how fast text streams out — what feels like "speed" in a chat UI.</li>
            <li><strong>Prefill tok/s</strong> is time-to-first-token for long prompts.</li>
            <li>Medians are outlier-resistant; overlapping <strong>[lo–hi] intervals</strong> mean the ranking is not settled.</li>
            {a.mixedEngines || b.mixedEngines ? (
              <li style={{ color: '#fbbf24' }}>One or both sides mix engine versions — treat the delta with caution.</li>
            ) : null}
          </ul>

          <p style={{ marginTop: 28 }}>
            Explore the raw runs, context-length effects and VRAM sizing in{' '}
            <a href="/">the visualizer</a>.
          </p>
        </>
      )}

      {moreComparisons.length > 0 && (
        <nav aria-label="More comparisons" style={{ marginTop: 48 }}>
          <h2 style={{ fontSize: 20 }}>More hardware comparisons</h2>
          <ul style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '4px 20px', paddingLeft: 20 }}>
            {moreComparisons.map(l => (
              <li key={`${l.sa}-vs-${l.sb}`}>
                <a href={`/compare/${l.sa}-vs-${l.sb}`}>{l.na} vs {l.nb}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </main>
  )
}
