// Export a simulation as a shareable step-by-step markdown walkthrough.
//
// Like exportPng.js, this has no external dependencies. The builders are pure
// functions (no DOM access) so the output is deterministic and unit-testable:
// the same inputs always produce byte-identical markdown, which is what makes
// the export safe to paste into slides, course notes, or homework evidence.

import { formatTime, formatTokens } from './presets.js';
import { copyTextToClipboard } from './clipboard.js';
import { fmtEn } from './numfmt.js';
import { calculateAgenticTimeline } from './agenticMath.js';
import { computeSingleTurnEngineRun } from './exportEngineMath.js';
import { buildShareLink } from './permalink.js';

import { evaluateSlo } from './slo.js';

// ---------------------------------------------------------------------------
// SLO budgets section (#425): mirrors the on-page ✓/✗ badges in exports.
// Returns '' when no budget is active so existing output is byte-identical.
// ---------------------------------------------------------------------------

const sloVerdict = (label, r, fmt) => r
  ? `| ${label} | ${fmt(r.value)} | ${fmt(r.budget)} | ${r.pass ? '✓ pass' : '✗ fail'} | ${Number.isFinite(r.marginPct) ? `${r.marginPct.toFixed(1)}%` : '∞'} |`
  : '';

function buildSloMarkdownSection(ttftSec, tpotMsValue, walltimeSecValue, budgets) {
  const r = evaluateSlo({ ttftSec, tpotMs: tpotMsValue, walltimeSec: walltimeSecValue }, budgets);
  const rows = [
    sloVerdict('TTFT', r.ttft, (ms) => `${Math.round(ms)} ms`),
    sloVerdict('TPOT', r.tpot, (ms) => `${Math.round(ms)} ms`),
    sloVerdict('Walltime', r.walltime, (sec) => formatTime(sec))
  ].filter(Boolean);
  if (rows.length === 0) return '';
  return `
## SLO budgets

| Metric | Value | Budget | Verdict | Margin |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

// ---------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------

// Build a URL that reproduces the exact config when opened. Routes through
// the canonical share-link builder (#875): keeps every current query param
// (preset, speeds, per-tab settings), pins `tab` to the exporting view, and
// strips transient state like autoplay.
export function buildDeepLink(tab) {
  if (typeof window === 'undefined') return '';
  return buildShareLink({
    origin: window.location.origin,
    pathname: window.location.pathname,
    search: window.location.search,
    tab
  });
}

// ---------------------------------------------------------------------------
// Single-turn chat export
// ---------------------------------------------------------------------------

export function buildSingleTurnMarkdown({
  promptTokens,
  outputTokens,
  prefillSpeed,
  decodeSpeed,
  specEnabled,
  draftTokens,
  acceptance,
  effectiveDecodeSpeed,
  ctxScaleEnabled,
  ctxHalf,
  imagesEnabled,
  imageCount,
  imageResId,
  jitterEnabled,
  jitterPct,
  deepLink,
  provenance,
  sloBudgets = null
}) {
  // Engine features (#698): attached images, context scaling and ITL jitter
  // are applied here exactly like the on-page simulation, via the shared
  // computeSingleTurnEngineRun — the same module exportJson.js uses, so the
  // MD walkthrough and JSON payload always agree with each other and with
  // the deepLink they embed.
  const run = computeSingleTurnEngineRun({
    promptTokens,
    outputTokens,
    prefillSpeed,
    decodeSpeed,
    specEnabled,
    draftTokens,
    acceptance,
    effectiveDecodeSpeed,
    ctxScaleEnabled,
    ctxHalf,
    imagesEnabled,
    imageCount,
    imageResId,
    jitterEnabled,
    jitterPct
  });
  const {
    safePrompt,
    safeOutput,
    imagesEnabled: imgOn,
    imageCount: imgN,
    imageResolutionLabel,
    imageTokensTotal,
    ctxScaleEnabled: ctxOn,
    ctxHalfSafe,
    jitterEnabled: jitOn,
    jitterPct: jitPctSafe,
    totalPrefillTokens,
    ttftSeconds: ttft,
    tpotMs,
    decodeTimeSeconds: decodeTime,
    totalWalltimeSeconds: total,
    avgDecodeSpeedTokPerSec,
    throughputTokPerSec: throughput,
    prefillSharePct: prefillPct,
    decodeSharePct: decodePct,
    itlSummary
  } = run;

  const specSection = specEnabled ? `
### Speculative decoding

\`\`\`
tokens/step = 1 + k·α = 1 + ${draftTokens}·${acceptance} = ${(1 + draftTokens * acceptance).toFixed(2)}
steps/s     = decode ÷ (1 + k·c_draft) = ${decodeSpeed} ÷ (1 + ${draftTokens}·0.2) = ${(decodeSpeed / (1 + draftTokens * 0.2)).toFixed(1)}
effective   = steps/s × tokens/step = ${Math.round(effectiveDecodeSpeed)} tok/s
\`\`\`

Draft model proposes k = ${draftTokens} tokens per step, target verifies in one pass; acceptance α = ${acceptance}, draft cost c_draft ≈ 0.2.
` : '';

  const imagesSection = imgOn ? `
### Attached images

${imgN} × ${imageResolutionLabel} attachment(s) tile into vision-encoder tokens that join the text prompt during prefill:

\`\`\`
prefill tokens = prompt + vision = ${fmtEn(safePrompt)} + ${fmtEn(imageTokensTotal)} = ${fmtEn(totalPrefillTokens)} tok
TTFT           = ${fmtEn(totalPrefillTokens)} ÷ ${prefillSpeed} = ${ttft.toFixed(4)}s (${formatTime(ttft)})
\`\`\`
` : '';
  const imagesInputRow = `| Attached images | ${imgOn ? `ON (${imgN} × ${imageResolutionLabel}, ${fmtEn(imageTokensTotal)} vision tok)` : 'OFF'} |`;

  const ctxSection = ctxOn ? `
### Context scaling

Decode slows as the KV cache fills (linear TPOT model, C½ = cache depth at half speed). Token i is produced at cache depth ${fmtEn(totalPrefillTokens)} + i:

\`\`\`
speed(c)      = base ÷ (1 + c/C½)
decode walltime = Σ tpot₀·(1 + (P+i)/C½) = closed form = ${decodeTime.toFixed(4)}s (${formatTime(decodeTime)})
avg speed     = ${Math.round(avgDecodeSpeedTokPerSec)} tok/s over ${safeOutput} tokens
\`\`\`

C½ = ${fmtEn(ctxHalfSafe)} tok.
` : '';
  const ctxInputRow = `| Context scaling | ${ctxOn ? `ON (C½ = ${fmtEn(ctxHalfSafe)} tok)` : 'OFF'} |`;

  const jitterSection = jitOn && itlSummary ? `
### ITL jitter

Seeded mean-preserving lognormal draws around the average TPOT (±${jitPctSafe}%): the average is unchanged, only the tail grows.

\`\`\`
p50 = ${itlSummary.p50.toFixed(1)} ms · p95 = ${itlSummary.p95.toFixed(1)} ms · p99 = ${itlSummary.p99.toFixed(1)} ms
decode time = sum of drawn gaps = ${decodeTime.toFixed(4)}s (${formatTime(decodeTime)})
\`\`\`
` : '';
  const jitterInputRow = `| ITL jitter | ${jitOn ? `ON (±${jitPctSafe}%)` : 'OFF'} |`;

  // Measurement provenance (#602): only rendered for lmx:<runId> presets so
  // synthetic-preset exports stay byte-identical to before.
  const provenanceSection = provenance ? `
### Measured provenance

Community-measured speeds (NOT synthetic preset defaults):

| Field | Value |
| --- | --- |
| Source run | ${provenance.runId} |
| Model | ${provenance.modelId ?? 'unknown'} |
| Quantization | ${provenance.quantization ?? 'unknown'} |
| Engine | ${[provenance.engine, provenance.engineVersion].filter(Boolean).join(' ') || 'unknown'} |
| Measured at | ${provenance.measuredAt ?? 'unknown'} (${provenance.ageDays} days ago, staleness: ${provenance.staleness}) |
| Source | ${provenance.sourceUrl} |
` : '';

  return `# Single-Turn Chat Simulation

Step-by-step walkthrough generated by the LLM Prefill & Decode Visualizer.

## Inputs

| Parameter | Value |
| --- | --- |
| Prompt length | ${fmtEn(safePrompt)} tok |
| Target output length | ${fmtEn(safeOutput)} tok |
| Prefill speed | ${fmtEn(prefillSpeed)} tok/s |
| Decode speed (base) | ${fmtEn(decodeSpeed)} tok/s |
| Speculative decoding | ${specEnabled ? `ON (k = ${draftTokens}, α = ${acceptance})` : 'OFF'} |
${imagesInputRow}
${ctxInputRow}
${jitterInputRow}
${[specSection, provenanceSection, imagesSection, ctxSection, jitterSection].filter(Boolean).join('\n')}
## Formulas

\`\`\`
TTFT   = prompt ÷ prefill        = ${safePrompt} ÷ ${prefillSpeed} = ${(safePrompt / prefillSpeed).toFixed(4)}s (${formatTime(ttft)})
TPOT   = 1000 ÷ decode          = 1000 ÷ ${Math.round(avgDecodeSpeedTokPerSec * 100) / 100} = ${Number.isFinite(tpotMs) ? `${tpotMs.toFixed(1)} ms` : '∞'}
Decode = output ÷ decode        = ${safeOutput} ÷ ${Math.round(avgDecodeSpeedTokPerSec * 100) / 100} = ${decodeTime.toFixed(4)}s (${formatTime(decodeTime)})
Total  = TTFT + Decode          = ${ttft.toFixed(4)} + ${decodeTime.toFixed(4)} = ${total.toFixed(4)}s (${formatTime(total)})
\`\`\`
${imgOn || ctxOn || jitOn ? `
Note: the formulas above substitute feature-aware values (attached images extend prefill; context scaling decays the per-token rate; jitter sums seeded per-token draws), matching the on-page run for this exact configuration.
` : ''}
## Final metrics

| Metric | Value |
| --- | --- |
| TTFT (time to first token) | ${formatTime(ttft)} |
| TPOT (time per output token) | ${Number.isFinite(tpotMs) ? `${tpotMs.toFixed(1)} ms` : '∞'} |
| Total chat walltime | ${formatTime(total)} |
| Effective throughput | ${throughput.toFixed(1)} tok/s |
| Walltime split | Prefill ${prefillPct.toFixed(1)}% · Decode ${decodePct.toFixed(1)}% |
${buildSloMarkdownSection(ttft, tpotMs, total, sloBudgets)}
## Reproduce this run

Open this URL — it encodes the exact configuration above:

\`\`\`
${deepLink}
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Agentic tool-loop export
// ---------------------------------------------------------------------------

export function buildAgenticMarkdown({
  numTurns,
  basePromptTokens,
  toolOutputTokensPerTurn,
  decodeTokensPerTurn,
  enablePrefixCaching,
  prefillSpeed,
  decodeSpeed,
  deepLink,
  sloBudgets = null
}) {
  const turns = calculateAgenticTimeline({
    numTurns,
    basePromptTokens,
    toolOutputTokensPerTurn,
    decodeTokensPerTurn,
    prefillSpeed,
    decodeSpeed,
    enablePrefixCaching
  });

  const totalWalltime = turns.reduce((acc, t) => acc + t.turnWalltime, 0);
  const noCacheWalltime = calculateAgenticTimeline({
    numTurns,
    basePromptTokens,
    toolOutputTokensPerTurn,
    decodeTokensPerTurn,
    prefillSpeed,
    decodeSpeed,
    enablePrefixCaching: false
  }).reduce((acc, t) => acc + t.turnWalltime, 0);
  const saved = noCacheWalltime - totalWalltime;
  const savedPct = noCacheWalltime > 0 ? (saved / noCacheWalltime) * 100 : 0;
  const finalContext = turns.length
    ? turns[turns.length - 1].totalPromptTokens + turns[turns.length - 1].decodeTokens
    : 0;
  const totalTokens = turns.reduce((acc, t) => acc + t.newTokensPrefilled + t.decodeTokens, 0);
  const throughput = totalWalltime > 0 ? totalTokens / totalWalltime : 0;

  const first = turns[0];
  const cachedTurn = turns.find(t => t.isCached);
  const decodeTurns = turns.filter(t => t.decodeTokens > 0);

  const waterfallRows = turns.map(t => [
    `T${t.turn}`,
    t.isCached ? 'cached ⚡' : 'full ingest',
    `${fmtEn(t.totalPromptTokens)}`,
    `${fmtEn(t.newTokensPrefilled)}`,
    formatTime(t.prefillTime),
    formatTime(t.decodeTime),
    formatTime(t.turnWalltime),
    formatTime(t.cumulativeWalltime)
  ]);
  const waterfallTable = [
    '| Turn | Prefill mode | History context | Prefilled tok | Prefill time | Decode time | Turn walltime | Cumulative |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...waterfallRows.map(r => `| ${r.join(' | ')} |`)
  ].join('\n');

  return `# Agentic Tool-Loop Simulation

Step-by-step walkthrough generated by the LLM Prefill & Decode Visualizer.

## Inputs

| Parameter | Value |
| --- | --- |
| Agent turns | ${numTurns} |
| Initial system prompt | ${fmtEn(basePromptTokens)} tok |
| Tool result per turn | +${fmtEn(toolOutputTokensPerTurn)} tok |
| Agent thought per turn | ${fmtEn(decodeTokensPerTurn)} tok |
| Prefill speed | ${fmtEn(prefillSpeed)} tok/s |
| Decode speed | ${fmtEn(decodeSpeed)} tok/s |
| Prefix caching | ${enablePrefixCaching ? 'ON (KV reuse)' : 'OFF (full re-prefill)'} |

## Formulas

\`\`\`
prefill_time(T) = new_tokens_prefilled ÷ prefill_speed
decode_time(T)  = decode_tokens_per_turn ÷ decode_speed
turn_walltime   = prefill_time + decode_time
\`\`\`

Turn 1 substituted:

\`\`\`
prefill_time = ${first.newTokensPrefilled} ÷ ${prefillSpeed} = ${first.prefillTime.toFixed(4)}s (${formatTime(first.prefillTime)})
decode_time  = ${decodeTokensPerTurn} ÷ ${decodeSpeed} = ${first.decodeTime.toFixed(4)}s (${formatTime(first.decodeTime)})
turn 1 total = ${first.prefillTime.toFixed(4)} + ${first.decodeTime.toFixed(4)} = ${first.turnWalltime.toFixed(4)}s (${formatTime(first.turnWalltime)})
\`\`\`
${cachedTurn ? `
With prefix caching, turn ${cachedTurn.turn}+ only prefills the newly appended tool output (${fmtEn(toolOutputTokensPerTurn)} tok) instead of the whole accumulated history:

\`\`\`
prefill_time(T${cachedTurn.turn}) = ${cachedTurn.newTokensPrefilled} ÷ ${prefillSpeed} = ${cachedTurn.prefillTime.toFixed(4)}s
\`\`\`
` : ''}
## Per-turn waterfall

${waterfallTable}

## Final metrics

| Metric | Value |
| --- | --- |
| Total walltime (${numTurns} turns) | ${formatTime(totalWalltime)} |
| Final context (KV cache) | ${fmtEn(finalContext)} tok |
| Tokens processed (prefill + decode) | ${fmtEn(totalTokens)} tok |
| Average throughput | ${throughput.toFixed(1)} tok/s |
| Without prefix caching | ${formatTime(noCacheWalltime)} |
| Caching savings | ${enablePrefixCaching ? `${formatTime(saved)} (${savedPct.toFixed(0)}%)` : '— (caching off)'} |
${buildSloMarkdownSection(first.prefillTime, decodeTurns.length > 0 ? decodeTurns.reduce((sum, t) => sum + (1000 * t.decodeTime) / t.decodeTokens, 0) / decodeTurns.length : Infinity, totalWalltime, sloBudgets)}
## Reproduce this run

Open this URL — it encodes the exact configuration above:

\`\`\`
${deepLink}
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Delivery: download as file + copy to clipboard
// ---------------------------------------------------------------------------

export function downloadMarkdown(markdown, filename = 'simulation.md') {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyMarkdownToClipboard(markdown) {
  // Shared helper (#1034): Clipboard API → readOnly execCommand fallback,
  // boolean success, never throws.
  return copyTextToClipboard(markdown);
}
