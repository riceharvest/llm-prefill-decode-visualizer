// Natural-language constraint parser (#65).
//
// Converts a plain-language constraint string — e.g.
//   "self-hosted Qwen 27B at Q4 for 10 users under $1500"
// — into the canonical constraint JSON used by /api/sizing and /api/best,
// plus an `ambiguities` array for everything the heuristics had to guess.
//
// Pure regex/heuristics: no external LLM calls, fully deterministic, so the
// same input always yields the same struct (agents can cache and diff it).
//
// The canonical fields mirror the structured query params of the decision
// endpoints so the output can be fed straight through:
//   deployment       → informational (self-hosted vs cloud)
//   modelFamily      → /api/best & /api/sizing ?model=
//   paramsB          → ?maxParamsB= (informational here)
//   quantization     → ?quant=
//   contextLength    → ?contextLength=
//   concurrency      → ?concurrency= (users/streams)
//   budgetUsdMax     → hardware budget cap
//   minDecodeTokPerSec → ?minDecode=
//   maxVramGb        → ?maxVramGb=
//   hwClass          → ?hwClass= (discrete_gpu|unified|cpu_only)

// Model families with their canonical lowercase keys. Longest/most specific
// patterns first so "llama 3" doesn't win over a plain "llama" and
// "command-r" isn't eaten by the generic word matcher.
const MODEL_FAMILIES = [
  [/deepseek[\s-]?r?o?c?[\s-]?\d*/i, 'deepseek'],
  [/command[\s-]?r/i, 'command-r'],
  [/qwen[\s-]?\d*(?:\.\d+)*/i, 'qwen'],
  [/llama[\s-]?\d*(?:\.\d+)*/i, 'llama'],
  [/mistral/i, 'mistral'],
  [/mixtral/i, 'mixtral'],
  [/gemma[\s-]?\d*/i, 'gemma'],
  [/phi[\s-]?\d*/i, 'phi'],
  [/tinyllama/i, 'tinyllama'],
  [/\byi[\s-]?\d{1,2}\b/i, 'yi'],
  [/falcon[\s-]?\d*/i, 'falcon']
];

// Quantization labels → canonical llama.cpp-style lowercase token.
// Bare levels ("Q4", "4-bit", "int4") canonicalize to qN and raise an
// ambiguity because the K-quant variant matters for quality and VRAM.
function parseQuantization(text) {
  // Full llama.cpp-style labels first: q4_k_m, iq3_xxs, q8_0 …
  let m = text.match(/\bi?q[1-8](?:_[a-z0-9]+)+\b/i);
  if (m) return { value: m[0].toLowerCase(), ambiguous: false };

  m = text.match(/\b(?:fp|bf)(?:16|8)\b|\bf16\b|\bf8\b/i);
  if (m) return { value: m[0].toLowerCase(), ambiguous: false };

  m = text.match(/\b(?:nvfp4|mxfp4|int[48])\b/i);
  if (m) {
    const v = m[0].toLowerCase().replace('int4', 'q4').replace('int8', 'q8');
    return { value: v, ambiguous: m[0].toLowerCase().startsWith('int') };
  }

  m = text.match(/\bq([1-8])\b/i) || text.match(/\b([1-8])\s*-?\s*bit\b/i);
  if (m) return { value: `q${m[1]}`, ambiguous: true };

  return { value: null, ambiguous: false };
}

function normalizeNumericString(s) {
  let str = String(s).replace(/[\s_]/g, '');
  // A trailing comma group of 1–2 digits is a decimal comma ("1,5"), not a
  // thousands separator ("70,000" groups into 3-digit blocks). #1061
  if (/^\d{1,3}(,\d{1,2})$/.test(str)) str = str.replace(',', '.');
  else str = str.replace(/,/g, '');
  return str;
}

function parseNumber(s) {
  const n = Number(normalizeNumericString(s));
  return Number.isFinite(n) ? n : null;
}

/** "$1.5k" → 1500, "$1500" → 1500, "2,500 dollars" → 2500. */
function parseMoney(s, suffix) {
  const n = parseNumber(s);
  if (n == null) return null;
  const mult = /k/i.test(suffix || '') ? 1000 : /m/i.test(suffix || '') ? 1e6 : 1;
  return n * mult;
}

/** "128k context" → 131072, "context length of 32768" → 32768. */
function parseContextLength(text) {
  let m = text.match(/\b(\d+(?:\.\d+)?)\s*k\b\s*(?:tokens?\s*)?context(?:\s*length)?\b/i);
  if (m) return Math.round(parseNumber(m[1]) * 1024);
  m = text.match(/\bcontext(?:\s*length)?\s*(?:of|:)?\s*(\d[\d,]*)\b/i);
  if (m) return parseNumber(m[1]);
  return null;
}

/**
 * Parse a natural-language constraint string into the canonical struct.
 * Returns { input, constraints, ambiguities } — `constraints` carries null
 * for anything not stated, `ambiguities` lists every assumption the parser
 * had to make so callers can ask the user instead of trusting a guess.
 */
export function parseConstraints(rawText) {
  const input = String(rawText ?? '').trim();
  // Collapse locale digit-grouping separators (NBSP, narrow NBSP, thin space,
  // underscore) between digits — but only for exactly-3-digit groups, so
  // "Qwen 3.6 27B" keeps its version spacing. #1061
  const text = input.toLowerCase().replace(/(?<=\d)[\s_](?=\d{3}(?!\d))/g, '');
  const constraints = {
    deployment: null,
    modelFamily: null,
    paramsB: null,
    quantization: null,
    contextLength: null,
    concurrency: null,
    budgetUsdMax: null,
    minDecodeTokPerSec: null,
    maxVramGb: null,
    hwClass: null
  };
  const ambiguities = [];

  // --- deployment -----------------------------------------------------------
  const selfHosted = /\bself[\s-]?host(?:ed|ing)?\b|\bon[\s-]?prem(ise)?\b|\blocall?y?\b|\bmy (?:own )?(?:machine|server|rig|laptop|desktop)\b/.test(text);
  // #899: `\bapi\b` removed — "having/exposing an API" says nothing about where
  // inference runs, and asserting `deployment: 'cloud'` from it broke the
  // ambiguities contract. Real cloud signals (provider names, "cloud",
  // "hosted service") are unchanged.
  const cloud = /\bcloud\b|\bmanaged\b|\bhosted (?:service|endpoint|provider)\b|\bopenrouter\b|\btogether\.?ai\b|\bgroq\b|\bfireworks\b/.test(text);
  if (selfHosted && cloud) {
    constraints.deployment = null;
    ambiguities.push({
      field: 'deployment',
      message: 'Both self-hosted and cloud wording found — which deployment mode did you mean?'
    });
  } else if (selfHosted) {
    constraints.deployment = 'self-hosted';
  } else if (cloud) {
    constraints.deployment = 'cloud';
  }

  // --- model family ---------------------------------------------------------
  for (const [re, canonical] of MODEL_FAMILIES) {
    const m = text.match(re);
    if (m) {
      constraints.modelFamily = canonical;
      break;
    }
  }

  // --- parameter count ------------------------------------------------------
  // Strip budget amounts first so "$1500" can't collide with a "1500B" match.
  const withoutMoney = text.replace(/\$?\s*[\d,.]+\s*(?:k|m)?\s*(?:usd|dollars|bucks)\b/g, ' ');
  // "27b" and "1t" both parse; trillions convert to billions. (#1068)
  const pm = withoutMoney.match(/\b(\d+(?:\.\d+)?)\s*x?\s*-?\s*([tb])\b/);
  if (pm) {
    const base = parseNumber(pm[1]);
    if (base != null) constraints.paramsB = pm[2] === 't' ? base * 1000 : base;
  }

  // --- quantization ---------------------------------------------------------
  const quant = parseQuantization(text);
  if (quant.value) {
    constraints.quantization = quant.value;
    if (quant.ambiguous) {
      ambiguities.push({
        field: 'quantization',
        message: `"${quant.value}" given without a variant — llama.cpp K-quants (q4_k_m vs q4_k_s) and plain q4_0 differ in quality and VRAM; assuming the bare level.`
      });
    }
  }

  // --- context length ---------------------------------------------------------
  constraints.contextLength = parseContextLength(text);

  // --- concurrency / users ----------------------------------------------------
  const um = text.match(/\b(\d+)\s*(concurrent\s+)?(?:users?|streams?|sessions?|clients?|simultaneous requests?|parallel requests?)\b/);
  const bm = text.match(/\b(?:batch size|batched?|batching)\s*(?:of|=|:)?\s*(\d+)\b/);
  if (bm) {
    constraints.concurrency = parseNumber(bm[1]);
  } else if (um) {
    constraints.concurrency = parseNumber(um[1]);
    if (!um[2]) {
      ambiguities.push({
        field: 'concurrency',
        message: `"${um[1]} ${/user/.test(um[0]) ? 'users' : um[0].trim()}": assume 1 stream each or batched? KV-cache VRAM and per-user decode speed differ sharply between the two.`
      });
    }
  }

  // --- hardware budget ----------------------------------------------------------
  // #899: the budget-prefix qualifier used to be OPTIONAL, so every "$X" in
  // the sentence (per-token prices, subscription bills) silently became a
  // hardware budget cap with an empty ambiguities[]. The qualifier is now
  // REQUIRED; unqualified money raises an ambiguity and leaves the field null.
  const money = text.match(/(?:under|below|max(?:imum)?(?: of)?|up to|less than|budget of|budget|cap(?:ped)? (?:at|of)|at most|<=?|≤)\s*\$\s*([\d,]+(?:\.\d+)?)\s*(k|m)?\b/);
  const moneyWords = money ? null : text.match(/(?:under|below|max(?:imum)?(?: of)?|up to|less than|budget of|budget|cap(?:ped)? (?:at|of)|at most)\s*([\d,]+(?:\.\d+)?)\s*(k|m)?\s*(?:usd|dollars|bucks)\b/);
  const budget = money
    ? parseMoney(money[1], money[2])
    : moneyWords
      ? parseMoney(moneyWords[1], moneyWords[2])
      : null;
  const moneySrc = money ? money[1] : moneyWords ? moneyWords[1] : null;
  if (budget != null) {
    constraints.budgetUsdMax = budget;
    if (/,\d{1,2}$/.test(moneySrc)) {
      ambiguities.push({
        field: 'budgetUsdMax',
        message: `"${moneySrc}" read as a decimal comma (budget ${budget}). If the comma was a thousands separator, restate the amount without it.` // #1061
      });
    }
  } else {
    const bareMoney = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k|m)?\b/);
    if (bareMoney) {
      ambiguities.push({
        field: 'budgetUsdMax',
        message: `"${bareMoney[0].trim()}" found but no budget wording ("under", "max", "budget", "cap"…) — this may be a per-token price or a bill rather than a hardware cap; leaving budgetUsdMax null. Rephrase with explicit budget wording if it is one.` // #890
      });
    }
  }

  // --- minimum decode speed ------------------------------------------------------
  // No leading \b before the operator alternation: a word boundary can never
  // hold between a space/string-start and ">" or "≥", which silently killed
  // ">= 30 tok/s". ≥ is accepted alongside <=/≤ used by the other fields. #1068
  const sm = text.match(/(?:\bat least\b|\bmin(?:imum)?(?: of)?\b|>=?|≥|\bno less than\b|\bover\b)\s*([\d,]+)\s*(?:tok(?:en)?s?)(?:\/s| per second|s\/sec|s\/s)\b/);
  if (sm) constraints.minDecodeTokPerSec = parseNumber(sm[1]);

  // --- VRAM cap --------------------------------------------------------------------
  // #899: the (memory|ram) fallback reads SYSTEM memory as a VRAM cap. The
  // value is still filled in (unified-memory rigs are the common case), but it
  // now raises an ambiguity so callers know the guess was made.
  let vm = text.match(/\b(\d{1,3})\s*gb?\s*(?:of\s*)?vram\b/) || text.match(/\bvram\s*(?:of|under|max|<=?|≤|budget)?\s*(\d{1,3})\s*gb?\b/);
  let vramAssumedFromRam = false;
  if (!vm) vm = text.match(/\b(\d{1,3})\s*gb?\s*(?:gpu|graphics card|card)\b/);
  if (!vm) {
    vm = text.match(/\b(\d{1,3})\s*gb?\s*(?:memory|ram)\b/);
    vramAssumedFromRam = !!vm;
  }
  if (vm) {
    constraints.maxVramGb = parseNumber(vm[1]);
    if (vramAssumedFromRam) {
      ambiguities.push({
        field: 'maxVramGb',
        message: `"${vm[0].trim()}" reads as system memory/RAM, not video memory — interpreting it as the VRAM cap. On discrete-GPU rigs VRAM differs from system RAM; state "GB of VRAM" explicitly if that is what you meant.`
      });
    }
  }

  // --- hardware class ----------------------------------------------------------------
  if (/\bunified(?:\s*memory)?\b|\bapple silicon\b|\bmac(?:book| mini| studio)?\b|\bm[1-4]\b(?=\s*(?:pro|max|ultra)?\b)/.test(text)) {
    constraints.hwClass = 'unified';
  } else if (/\bcpu[\s-]?only\b|\bcpu inference\b|\bno gpu\b/.test(text)) {
    constraints.hwClass = 'cpu_only';
  } else if (/\bgpus?\b|\bcuda\b|\brtx\b|\bradeon\b/.test(text)) {
    constraints.hwClass = 'discrete_gpu';
  }

  // --- catch-all -----------------------------------------------------------------
  if (input
      && /[<>≤≥]\s*\d/.test(text)
      && constraints.budgetUsdMax == null
      && constraints.minDecodeTokPerSec == null
      && constraints.maxVramGb == null
      && !Object.values(constraints).every(v => v == null)) {
    ambiguities.push({
      field: 'input',
      message: 'Input contains a numeric comparison (>, <, <=, ≥) that did not map to budget, minimum decode speed, or VRAM cap — restate using words like "under $X", "at least N tok/s", or "N gb VRAM".' // #1068
    });
  }
  if (!input) {
    ambiguities.push({
      field: 'input',
      message: 'Empty input — pass ?q=<plain-language constraints> (or POST {"q": "..."}).'
    });
  } else if (Object.values(constraints).every(v => v == null)) {
    ambiguities.push({
      field: 'input',
      message: 'No recognizable constraints found. Try phrasing like "self-hosted Qwen 27B at Q4 for 10 users under $1500".'
    });
  }

  return { input, constraints, ambiguities };
}

// Bare quantization level ("q4", "q8", "iq3"): matches no stored benchmark
// tag (those are full llama.cpp labels like q4_k_m), so feeding it to
// /api/sizing as ?quant= silently returns zero runs (#563). The parser keeps
// it in `constraints.quantization` but the ready-made query omits it.
const COARSE_QUANT_RE = /^i?q[1-8]$/i;

export function isCoarseQuantLabel(quantization) {
  return COARSE_QUANT_RE.test(String(quantization || ''));
}

/**
 * Map the canonical constraints onto the structured query params of
 * /api/sizing (the downstream decision endpoint), so agents can chain
 * parse-constraints → sizing in one step. Fields with no sizing param are
 * skipped; null fields are omitted entirely. A bare-level quantization
 * ("Q4") is omitted too (#563): the stored quants are K-variant tags like
 * q4_k_m, and exact-match filtering on "q4" matches zero runs — dropping the
 * token yields working recommendations instead of a dead pipeline.
 */
export function constraintsToSizingQuery(constraints) {
  const params = new URLSearchParams();
  if (constraints.modelFamily) params.set('model', constraints.modelFamily);
  if (constraints.quantization && !isCoarseQuantLabel(constraints.quantization)) {
    params.set('quant', constraints.quantization);
  }
  if (constraints.contextLength) params.set('contextLength', String(constraints.contextLength));
  if (constraints.concurrency) params.set('concurrency', String(constraints.concurrency));
  if (constraints.maxVramGb) params.set('maxVramGb', String(constraints.maxVramGb));
  // #607: /api/sizing now accepts budgetUsdMax, so the recognized constraint
  // survives the parse-constraints → sizing chain instead of being dropped.
  if (constraints.budgetUsdMax) params.set('budgetUsdMax', String(constraints.budgetUsdMax));
  if (constraints.hwClass) params.set('hwClass', constraints.hwClass);
  return params;
}
