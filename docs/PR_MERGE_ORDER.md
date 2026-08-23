# PR Merge-Readiness Audit & Recommended Merge Order

**Audit date:** 2026-08-23 · **Range:** open PRs #311–#356 (43 PRs) · **Baseline:** `origin/main` @ `78c96a1`

## Method

Every PR head was test-merged against `origin/main` with `git merge-tree --write-tree` (no working-tree
merges performed). Because all 43 PRs are individually clean against main, a second pass simulated
*sequential* merges: for each of the 122 file-overlapping pairs, both orderings (`A` then `B`,
`B` then `A`) were merged synthetically via `git merge-tree` + `git commit-tree` to find real
conflicts and any ordering constraints. Finally, the full recommended order below was replayed
end-to-end as one continuous synthetic merge chain; the conflict notes per PR are the actual
`merge-tree` output from that replay.

**Key finding:** all 43 PRs merge clean onto current main in isolation. Every conflict in this audit
is *pairwise between PRs*, and all 54 conflicting pairs are symmetric (either order conflicts), so
the second PR of each pair always needs a small manual resolution — none are semantic blockers.

## Wave summary

| Wave | PRs | Rule |
|---|---|---|
| **W1 — Independents** | 14 | Zero pairwise conflicts; merge in any order |
| **W2 — llms.txt trio** | #316 → #334 → #339 | Strict order |
| **W3 — Small pairwise clusters** | 9 | Ordered within cluster; one resolution each |
| **W4 — Contract / API suites** | 15 | Last; heaviest overlap, mechanical resolutions expected |
| closed, not merged | #323, #326 | Superseded by #353 |

---

## Wave 1 — Independents (any order)

No conflicts with any other PR in the range:

`#320` (validate ?tab= param) · `#327` (OpenAPI schema drift tests) · `#332` (agent crosscheck) ·
`#333` (agent export JSON) · `#335` (agent scenario v2) · `#336` (og absolute URLs) ·
`#340` (AGENTS.md rewrite) · `#342` (MCP tool contracts) · `#343` (problem+json conformance) ·
`#344` (pagination cursor contract) · `#345` (JSON Schema files) · `#347` (AGENT_COOKBOOK.md) ·
`#354` (sitemap regen) · `#355` (agent API contracts)

> Note: #339 is also pairwise-independent but is pinned into W2 by the trio ordering.
> #355 touches `api/[...path].js` like several W4 PRs but in non-overlapping regions — verified clean.

## Wave 2 — llms.txt trio (strict order)

1. **#316** docs/llms-txt-tabs — clean vs everything at this point
2. **#334** feat/llms-txt-agentparse — ⚠️ **conflict: `public/llms.txt`** (vs #316). Resolve by keeping
   the tab list from #316 inside the agent-parseable structure from #334. Also conflicts with #314
   (`package.json`) if #314 has already landed — see W4 note on #314.
3. **#339** docs/llms-txt-index — clean after both

#316 → #334 is a true content conflict (both rewrite the same section); #339 only appends and is
clean either way, but keep the strict order for reviewability.

## Wave 3 — Small pairwise clusters

Ordered internally so the first merge of each cluster is clean; later members need small resolutions.

**UI/a11y cluster — `src/components/BatchingVisualizer.jsx`:**
1. **#311** a11y control names + keyboard — clean
2. **#337** reset-button aria-labels — ⚠️ conflict `src/components/BatchingVisualizer.jsx`
3. **#338** compare aggregate decode math — ⚠️ conflict `src/components/BatchingVisualizer.jsx`
4. **#341** OpenAPI operationId lock — ⚠️ conflict `src/components/BatchingVisualizer.jsx`

All three conflict symmetrically with #311's handler-table edits; each needs its rows rebased onto
#311's version. (#337/#338/#341 don't conflict among themselves.)

**index.html pair:** **#313** (structured data) first — clean; then **#318** (drop PostalAddress)
— ⚠️ conflict `index.html`, trivial (delete the PostalAddress block).

**Quickstart:** **#328** first — clean; #330 lands in W4 and resolves `docs/AGENT-QUICKSTART.md` there.

**dump-openapi pair:** **#319** (component schemas) first — clean; then **#349** (SDK workflow fix)
— ⚠️ conflict `scripts/dump-openapi.mjs` (both edit the spec dump import block; keep both edits).
#349 also carries an add/add conflict on `api/_changelog.test.js` against #351 — resolved when #351
lands in W4 (keep #351's fuller fixture).

## Wave 4 — Contract / API suites (last)

Heaviest file overlap: `CHANGELOG-API.md` (9 PRs), `api/[...path].js` (8 PRs), `public/llms.txt`,
`api/_handlers/spec.js`, `.github/workflows/ci.yml`, `public/agents.json`. Recommended internal order
(validated by full-chain replay):

### 4a. CI gate suite
1. **#353** sim-CI gate integration — clean. **Supersedes #323 and #326**: close those two without
   merging (all three add/add-conflict on `.github/workflows/ci.yml`; #353 already contains the
   integration of both).
2. **#325** agents.json capability table — ⚠️ conflict `.github/workflows/ci.yml` +
   `api/_math.test.js` (vs #353). Keep #353's workflow; union the math-test cases.

### 4b. Router + changelog suite
Each subsequent merge expects a **mechanical `CHANGELOG-API.md` conflict** (append-only file — keep
both entries). `api/[...path].js` route-handler conflicts need the new route blocks kept side by side.

3. **#315** `/api/runs` dump — ⚠️ `public/agents.json`
4. **#317** api version mapping docs — ⚠️ `CHANGELOG-API.md`
5. **#324** agent capabilities endpoint — ⚠️ `CHANGELOG-API.md`
6. **#329** agent compute endpoint — ⚠️ `api/[...path].js`
7. **#330** rate_limit object — ⚠️ `CHANGELOG-API.md`, `api/[...path].js`, `docs/AGENT-QUICKSTART.md` (add/add vs #328; union both quickstart sections)
8. **#331** agent benchmarks endpoint — ⚠️ `CHANGELOG-API.md`
9. **#348** agent scenario endpoint — ⚠️ `api/[...path].js`
10. **#350** agent freshness endpoint — ⚠️ `CHANGELOG-API.md`, `api/[...path].js`, `public/agents.json`
11. **#351** version endpoint + CHANGELOG.json — ⚠️ `CHANGELOG-API.md`, `api/_changelog.test.js` (add/add vs #349; keep #351's version)
12. **#352** x-rate-limit OpenAPI extension — ⚠️ `CHANGELOG-API.md`
13. **#346** schema-endpoint JSON Schemas — ⚠️ `api/_handlers/spec.js` (vs #352's x-rate-limit additions; nest both extensions)

### 4c. Remaining
14. **#356** agents.json generator — ⚠️ `public/agents.json` (vs #315/#325 hand-edited tables; prefer the generated table, re-adding #315's runs entry)
15. **#314** SSR initial chart state — ⚠️ `package.json` (version/metadata bump vs #334 from W2; keep #334's fields and take #314's version). Held until last so it only ever conflicts once.

## Conflict inventory (54 symmetric pairs)

- `public/llms.txt`: #316↔#334
- `package.json`: #314↔#334
- `index.html`: #313↔#318
- `docs/AGENT-QUICKSTART.md` (add/add): #328↔#330
- `scripts/dump-openapi.mjs`: #319↔#349 · `api/_changelog.test.js` (add/add): #349↔#351
- `src/components/BatchingVisualizer.jsx`: #311↔{#337,#338,#341}
- `.github/workflows/ci.yml` (add/add): #323↔#326↔#353, plus #325/#326 vs #353 after landing
- `api/_math.test.js`: {#323,#326,#353}↔#325
- `api/[...path].js`: #315,#317,#324,#329,#330,#331,#348,#350 pairwise subset (see per-PR notes)
- `CHANGELOG-API.md`: #315,#317,#324,#330,#331,#350,#351,#352 pairwise subset (see per-PR notes)
- `public/agents.json`: #315↔{#325,#350,#356}, #325↔#356
- `api/_handlers/spec.js`: #346↔#352

## Verification

The order above was replayed as one synthetic merge chain (`git merge-tree --write-tree` +
`git commit-tree` per step) against `78c96a1`: 21 merges land clean, 20 land with exactly the
conflicts listed above (no surprises beyond the inventory), and all 43 PRs are accounted for
(41 merged + 2 superseded). After each wave, run the standard gate:
`node --test "**/*.test.js" && oxlint && vite build`.
