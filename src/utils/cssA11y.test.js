// Contrast + visibility guards for the client CSS (issues #451 #454 #455 #456).
// Parses src/index.css / index.html directly so a future palette edit that
// re-introduces a WCAG AA failure or hover-gated hint content fails CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'index.css'), 'utf8');

// --- WCAG 2.x relative luminance / contrast ------------------------------
const srgb = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
};
const contrast = (a, b) => {
  let [la, lb] = [luminance(a), luminance(b)];
  if (la < lb) [la, lb] = [lb, la];
  return (la + 0.05) / (lb + 0.05);
};
const blend = (fgHex, alpha, bgHex) => {
  const f = fgHex.replace('#', '');
  const g = bgHex.replace('#', '');
  const out = [0, 2, 4].map((i) =>
    Math.round(alpha * parseInt(f.slice(i, i + 2), 16) + (1 - alpha) * parseInt(g.slice(i, i + 2), 16))
  );
  return '#' + out.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
};

const token = (name) => {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(m, `token --${name} not found in index.css`);
  return m[1].toUpperCase();
};

test('#451: --text-subtle meets WCAG AA (>=4.5:1) on every background token', () => {
  const subtle = token('text-subtle');
  for (const bg of ['bg-app', 'bg-panel', 'bg-inset', 'bg-raised', 'bg-hover']) {
    const ratio = contrast(subtle, token(bg));
    assert.ok(ratio >= 4.5, `--text-subtle ${subtle} on --${bg} = ${ratio.toFixed(2)}:1 (needs >=4.5:1)`);
  }
});

test('#454: .slo-fail text meets WCAG AA on its own tinted chip background', () => {
  const m = css.match(/\.slo-fail\s*\{([^}]*)\}/);
  assert.ok(m, '.slo-fail rule not found');
  const colorM = m[1].match(/color\s*:\s*(#[0-9A-Fa-f]{6})/);
  assert.ok(colorM, '.slo-fail must carry a literal AA-passing color');
  // The chip may render over any panel surface; check all of them.
  for (const bg of ['bg-panel', 'bg-inset', 'bg-raised']) {
    const surface = blend('#F87171', 0.12, token(bg));
    const ratio = contrast(colorM[1].toUpperCase(), surface);
    assert.ok(ratio >= 4.5, `.slo-fail ${colorM[1]} on ${surface} = ${ratio.toFixed(2)}:1 (needs >=4.5:1)`);
  }
});

test('#455: .hint-text is not clamped, dimmed, or hover-gated anymore', () => {
  // Collect every .hint-text rule block plus any selector mentioning it.
  const rules = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter(
    (r) => r[1].includes('.hint-text')
  );
  assert.ok(rules.length >= 1, 'expected at least one .hint-text rule');
  for (const rule of rules) {
    const selector = rule[1];
    const body = rule[2];
    assert.ok(!/-webkit-line-clamp/.test(body), `.hint-text rule "${selector.trim()}" must not line-clamp`);
    assert.ok(!/opacity\s*:/.test(body), `.hint-text rule "${selector.trim()}" must not dim via opacity`);
    assert.ok(!/:hover\s*\.hint-text|\.hint-text[^{]*:hover/.test(selector), `no hover gating on .hint-text ("${selector.trim()}")`);
  }
});

test('#456: index.html declares the dark theme via meta theme-color', () => {
  const html = readFileSync(join(root, '..', 'index.html'), 'utf8');
  const m = html.match(/<meta\s+name="theme-color"\s+content="(#[0-9A-Fa-f]{6})"/);
  assert.ok(m, 'theme-color meta missing from index.html');
  assert.equal(m[1].toUpperCase(), token('bg-app'), 'theme-color should match --bg-app');
});
