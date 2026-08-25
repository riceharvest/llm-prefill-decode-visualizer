// Export a machine-readable sizing report from any scenario (issue #49).
//
// Like exportMarkdown.js, this has no external dependencies and the builders
// are pure functions (no DOM access) so the same inputs always produce
// byte-identical output — deterministic enough to diff in CI or paste straight
// into infra-as-code repos, procurement tickets, and deployment runbooks.
//
// One canonical data object feeds all three formats (JSON / YAML / Markdown),
// so the formats can never disagree about the numbers.

// Community-submitted strings (system names, GPU labels, engine, model id from
// localmaxxing.com run submissions) must not carry Markdown structure into the
// export (#896) — same discipline as escapeHtmlAttr for the HTML variants.
import { escapeMarkdownText as esc } from './embedSnippet.js';

// ---------------------------------------------------------------------------
// Canonical report object
// ---------------------------------------------------------------------------

import { fmtEn } from './numfmt.js';
function round(value, digits = 2) {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

export function buildSizingReport({
  generatedAt,
  deepLink,
  scenario,
  systemA,
  systemB,
  tco = null,
  notes = []
}) {
  // Recommended rig: fastest total walltime wins; ties keep System A.
  const candidates = [systemA, systemB].filter(Boolean);
  const winner = candidates.reduce((best, s) =>
    (Number.isFinite(s.totalWalltimeSeconds) && Number.isFinite(best.totalWalltimeSeconds)
      ? s.totalWalltimeSeconds < best.totalWalltimeSeconds : false) ? s : best
  , candidates[0]);

  return {
    schema: 'sizing-report',
    version: 1,
    generatedAt: generatedAt || null,
    generator: 'LLM Prefill & Decode Visualizer',
    deepLink: deepLink || null,
    scenario: {
      modelId: scenario.modelId || null,
      quantization: scenario.quantization || null,
      contextTokens: scenario.contextTokens ?? null,
      outputTokens: scenario.outputTokens ?? null,
      concurrency: scenario.concurrency ?? 1
    },
    systems: candidates.map(s => ({
      id: s.id,
      name: s.name,
      engine: s.engine || null,
      engineVersion: s.engineVersion || null,
      measuredAt: s.measuredAt || null,
      ageDays: Number.isFinite(s.ageDays) ? s.ageDays : null,
      staleness: s.staleness || null,
      tokPerSec: {
        prefillMeasured: Number.isFinite(s.prefillSpeed) ? s.prefillSpeed : null,
        decodeMeasuredPerUser: Number.isFinite(s.decodeSpeed) ? s.decodeSpeed : null,
        decodeBatchedPerUser: Number.isFinite(s.batchedPerUserDecode) ? round(s.batchedPerUserDecode, 1) : null,
        decodeAggregateBatched: Number.isFinite(s.aggregateDecode) ? round(s.aggregateDecode, 1) : null
      },
      latency: {
        ttftSeconds: Number.isFinite(s.ttftSeconds) ? round(s.ttftSeconds, 4) : null,
        decodeSeconds: Number.isFinite(s.decodeSeconds) ? round(s.decodeSeconds, 4) : null,
        totalWalltimeSeconds: Number.isFinite(s.totalWalltimeSeconds) ? round(s.totalWalltimeSeconds, 4) : null
      },
      vramBreakdown: {
        hwClass: s.hwClass || null,
        gpuName: s.gpuName || null,
        gpuCount: Number.isFinite(s.gpuCount) ? s.gpuCount : null,
        totalVramGb: Number.isFinite(s.totalVramGb) ? s.totalVramGb : null,
        unifiedMemoryGb: Number.isFinite(s.unifiedMemoryGb) ? s.unifiedMemoryGb : null,
        note: s.vramNote || null
      },
      cost: {
        perRequestUsd: Number.isFinite(s.costPerRequestUsd) ? round(s.costPerRequestUsd, 4) : null,
        streetPriceUsd: Number.isFinite(s.streetPriceUsd) ? s.streetPriceUsd : null,
        streetPriceRangeUsd: Array.isArray(s.streetPriceRangeUsd) ? s.streetPriceRangeUsd : null,
        priceSourceUrl: s.sourceUrl || null
      }
    })),
    verdicts: buildVerdicts({ systemA, systemB }),
    recommendation: winner
      ? {
          systemId: winner.id,
          name: winner.name,
          reason: candidates.length > 1
            ? `fastest total walltime (${round(winner.totalWalltimeSeconds, 4)}s vs ${
              round(candidates.find(s => s !== winner)?.totalWalltimeSeconds ?? winner.totalWalltimeSeconds, 4)}s)`
            : 'only system in this scenario'
        }
      : null,
    tco: tco
      ? {
          localRigName: tco.rigName || null,
          wattsUnderLoad: Number.isFinite(tco.watts) ? tco.watts : null,
          electricityUsdPerKwh: Number.isFinite(tco.kwh) ? tco.kwh : null,
          cloudUsdPerMtok: Number.isFinite(tco.cloudPerMtok) ? tco.cloudPerMtok : null,
          monthlyElectricityUsd: Number.isFinite(tco.monthlyElectricity) ? round(tco.monthlyElectricity) : null,
          monthlyCapexUsd: Number.isFinite(tco.monthlyCapex) ? round(tco.monthlyCapex) : null,
          localMarginalUsdPerMtok: Number.isFinite(tco.localPerMtok) ? round(tco.localPerMtok, 4) : null,
          breakEvenTokensPerMonth: Number.isFinite(tco.breakEvenTokens) ? Math.round(tco.breakEvenTokens) : null
        }
      : null,
    notes
  };
}

function buildVerdicts({ systemA, systemB }) {
  const verdicts = [];

  if (systemA && systemB
    && Number.isFinite(systemA.totalWalltimeSeconds) && Number.isFinite(systemB.totalWalltimeSeconds)) {
    const faster = systemA.totalWalltimeSeconds <= systemB.totalWalltimeSeconds ? systemA : systemB;
    const slower = faster === systemA ? systemB : systemA;
    verdicts.push({
      check: 'faster-system',
      status: 'info',
      detail: `${faster.name} completes the request in ${formatDuration(faster.totalWalltimeSeconds)} vs ${formatDuration(slower.totalWalltimeSeconds)} (${(slower.totalWalltimeSeconds / faster.totalWalltimeSeconds).toFixed(2)}x).`
    });
  }

  for (const s of [systemA, systemB]) {
    if (!s) continue;
    if (s.staleness === 'stale') {
      verdicts.push({
        check: `${s.id}-measurement-freshness`,
        status: 'warn',
        detail: `${s.name}: measurement is stale (>1 year old${s.measuredAt ? `, taken ${s.measuredAt.slice(0, 10)}` : ''}); treat its numbers as indicative only.`
      });
    } else if (s.staleness === 'aging') {
      verdicts.push({
        check: `${s.id}-measurement-freshness`,
        status: 'info',
        detail: `${s.name}: measurement is aging (<1 year old${s.measuredAt ? `, taken ${s.measuredAt.slice(0, 10)}` : ''}).`
      });
    }
  }

  return verdicts;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds >= 60) return `${(seconds / 60).toFixed(1)} min`;
  if (seconds >= 1) return `${seconds.toFixed(2)} s`;
  return `${Math.round(seconds * 1000)} ms`;
}

// ---------------------------------------------------------------------------
// Format builders
// ---------------------------------------------------------------------------

export function buildSizingReportJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function buildSizingReportYaml(report) {
  return `${toYaml(report)}\n`;
}

const YAML_PLAIN_SAFE = /^[A-Za-z0-9_][A-Za-z0-9_\-./:@ ]*$/;
// YAML 1.1 parsers type bare ISO dates as timestamps; quoting keeps the YAML
// output type-identical to the JSON output (strings stay strings).
const LOOKS_LIKE_DATE = /^\d{4}-\d{2}-\d{2}/;

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const str = String(value);
  if (str === '') return "''";
  if (LOOKS_LIKE_DATE.test(str)) return JSON.stringify(str);
  if (YAML_PLAIN_SAFE.test(str) && str === str.trim() && !str.includes(': ') && !/:\s*$/.test(str)) {
    return str;
  }
  // JSON string escaping is valid YAML double-quote escaping.
  return JSON.stringify(str);
}

function toYaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (value === null || typeof value !== 'object') return pad + yamlScalar(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value.map(item => {
      if (item !== null && typeof item === 'object') {
        const inner = toYaml(item, indent + 1);
        // First key rides on the "- " line; the rest keep their indentation,
        // which aligns exactly under that first key.
        return `${pad}- ${inner.slice((indent + 1) * 2)}`;
      }
      return `${pad}- ${yamlScalar(item)}`;
    }).join('\n');
  }

  const keys = Object.keys(value);
  if (keys.length === 0) return `${pad}{}`;
  return keys.map(key => {
    const v = value[key];
    if (v !== null && typeof v === 'object' && ((!Array.isArray(v)) || v.length > 0)) {
      return `${pad}${key}:\n${toYaml(v, indent + 1)}`;
    }
    if (Array.isArray(v)) return `${pad}${key}: []`; // empty array
    return `${pad}${key}: ${v === null ? 'null' : yamlScalar(v)}`;
  }).join('\n');
}

export function buildSizingReportMarkdown(report) {
  const s = report.scenario;
  const lines = [];
  lines.push('# Hardware Sizing Report');
  lines.push('');
  lines.push(`Machine-readable sizing snapshot generated by ${report.generator}.`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt || 'unknown'}`);
  lines.push('');
  lines.push('## Scenario');
  lines.push('');
  lines.push('| Parameter | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Model | ${esc(s.modelId || '—')} |`);
  lines.push(`| Quantization | ${esc(s.quantization || '—')} |`);
  lines.push(`| Context length | ${fmtEn(s.contextTokens ?? 0)} tok |`);
  lines.push(`| Target output | ${fmtEn(s.outputTokens ?? 0)} tok |`);
  lines.push(`| Concurrency | ${s.concurrency}× |`);
  lines.push('');

  lines.push('## Systems');
  lines.push('');
  for (const sys of report.systems) {
    lines.push(`### ${esc(sys.name)}`);
    lines.push('');
    lines.push('| Property | Value |');
    lines.push('| --- | --- |');
    if (sys.engine) {
      lines.push(`| Engine | ${sys.engineVersion ? `${esc(sys.engine)} ${esc(sys.engineVersion)}` : esc(sys.engine)} |`);
    }
    if (sys.measuredAt) {
      const ageTag = sys.staleness ? ` (${sys.staleness})` : '';
      lines.push(`| Measured | ${sys.measuredAt.slice(0, 10)}${ageTag} |`);
    }
    lines.push(`| Prefill (measured) | ${fmt(sys.tokPerSec.prefillMeasured)} tok/s |`);
    lines.push(`| Decode per user (measured) | ${fmt(sys.tokPerSec.decodeMeasuredPerUser)} tok/s |`);
    if (report.scenario.concurrency > 1) {
      lines.push(`| Decode per user @ ${report.scenario.concurrency}× batch | ${fmt(sys.tokPerSec.decodeBatchedPerUser)} tok/s |`);
      lines.push(`| Aggregate decode @ ${report.scenario.concurrency}× batch | ${fmt(sys.tokPerSec.decodeAggregateBatched)} tok/s |`);
    }
    lines.push(`| TTFT | ${fmtDur(sys.latency.ttftSeconds)} |`);
    lines.push(`| Decode time | ${fmtDur(sys.latency.decodeSeconds)} |`);
    lines.push(`| Total walltime | **${fmtDur(sys.latency.totalWalltimeSeconds)}** |`);
    const v = sys.vramBreakdown;
    const vramBits = [esc(v.gpuName), v.gpuCount > 1 ? `×${v.gpuCount}` : null,
      v.totalVramGb != null ? `${v.totalVramGb} GB VRAM` : null,
      v.unifiedMemoryGb != null ? `${v.unifiedMemoryGb} GB unified` : null].filter(Boolean);
    lines.push(`| Memory | ${vramBits.length ? vramBits.join(' ') : esc(v.note || '—')} |`);
    if (sys.cost.streetPriceUsd != null) {
      const range = sys.cost.streetPriceRangeUsd ? ` ($${fmtEn(sys.cost.streetPriceRangeUsd[0])}–$${fmtEn(sys.cost.streetPriceRangeUsd[1])})` : '';
      lines.push(`| Street price | $${fmtEn(sys.cost.streetPriceUsd)}${range} |`);
    }
    if (sys.cost.perRequestUsd != null) lines.push(`| Cost per request | $${sys.cost.perRequestUsd.toFixed(4)} |`);
    lines.push('');
  }

  if (report.verdicts.length) {
    lines.push('## Verdicts');
    lines.push('');
    for (const v of report.verdicts) {
      lines.push(`- **[${v.status.toUpperCase()}]** ${esc(v.check)} — ${esc(v.detail)}`);
    }
    lines.push('');
  }

  if (report.recommendation) {
    lines.push('## Recommended hardware');
    lines.push('');
    lines.push(`${esc(report.recommendation.name)} — ${esc(report.recommendation.reason)}.`);
    lines.push('');
  }

  if (report.tco) {
    lines.push('## Total cost of ownership');
    lines.push('');
    lines.push('| Item | Value |');
    lines.push('| --- | --- |');
    if (report.tco.localRigName) lines.push(`| Local rig | ${esc(report.tco.localRigName)} |`);
    if (report.tco.wattsUnderLoad != null) lines.push(`| Wattage under load | ${report.tco.wattsUnderLoad} W |`);
    if (report.tco.electricityUsdPerKwh != null) lines.push(`| Electricity | $${report.tco.electricityUsdPerKwh}/kWh |`);
    if (report.tco.localMarginalUsdPerMtok != null) lines.push(`| Local marginal cost | $${report.tco.localMarginalUsdPerMtok}/Mtok |`);
    if (report.tco.cloudUsdPerMtok != null) lines.push(`| Cloud price | $${report.tco.cloudUsdPerMtok}/Mtok |`);
    if (report.tco.monthlyElectricityUsd != null) lines.push(`| Electricity (24/7) | $${report.tco.monthlyElectricityUsd.toFixed(2)}/mo |`);
    if (report.tco.breakEvenTokensPerMonth != null) {
      lines.push(`| Break-even volume | ${fmtEn(report.tco.breakEvenTokensPerMonth)} tok/mo |`);
    } else if (report.tco.cloudUsdPerMtok != null) {
      lines.push('| Break-even volume | none — cloud is cheaper at any volume |');
    }
    lines.push('');
  }

  if (report.notes.length) {
    lines.push('## Notes');
    lines.push('');
    for (const n of report.notes) lines.push(`- ${esc(n)}`);
    lines.push('');
  }

  if (report.deepLink) {
    lines.push('## Reproduce this scenario');
    lines.push('');
    lines.push('```');
    lines.push(report.deepLink);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function fmt(v) {
  return v == null ? '—' : fmtEn(Math.round(v));
}

function fmtDur(sec) {
  return sec == null ? '—' : formatDuration(sec);
}

// ---------------------------------------------------------------------------
// Delivery: download as file (mirrors downloadMarkdown in exportMarkdown.js)
// ---------------------------------------------------------------------------

export function downloadSizingReport(text, filename, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
