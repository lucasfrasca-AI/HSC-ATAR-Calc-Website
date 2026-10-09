#!/usr/bin/env node
// WCAG contrast gate. Zero dependencies. Reads the theme blocks from the
// tokens CSS, composites glass surfaces over the page (worst case: over the
// ambient glow at full strength) and fails if any pairing is under its floor.
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "src/styles/tokens.css";
const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const themes = {};
for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const names = [...m[1].matchAll(/data-theme="([^"]+)"/g)].map((x) => x[1]);
  if (!names.length) continue;
  const vars = {};
  for (const d of m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
  for (const n of names) themes[n] = vars;
}

const hsl = (s) => {
  const m = s.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) throw new Error(`not an HSL triplet: "${s}"`);
  const [h, sat, l] = [+m[1], +m[2] / 100, +m[3] / 100];
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
};
const mix = (top, under, alpha) => top.map((c, i) => c * alpha + under[i] * (1 - alpha));
const lum = (rgb) =>
  rgb
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground token, background, floor, label]
const TEXT = 4.5, UI = 3;
const PAIRS = [
  ["foreground", "page", TEXT, "body text"],
  ["foreground", "glass", TEXT, "body text on glass"],
  ["foreground-2", "glass", TEXT, "secondary text on glass"],
  ["foreground-3", "glass", TEXT, "tertiary text on glass"],
  ["foreground-3", "page", TEXT, "tertiary text on page"],
  ["accent", "glass", TEXT, "links on glass"],
  ["accent", "page", TEXT, "links on page"],
  ["gain", "glass", TEXT, "gain text"],
  ["loss", "glass", TEXT, "loss / error text"],
  ["warn", "glass", TEXT, "warning text"],
  ["dropped", "glass", TEXT, "not-counted text"],
  ["internal", "glass", TEXT, "internal label text"],
  ["exam", "glass", TEXT, "exam label text"],
  ["on-accent", "accent-fill", TEXT, "primary button text"],
  ["on-fill", "internal", TEXT, "text on internal fill"],
  ["on-fill", "exam", TEXT, "text on exam fill"],
  ["on-fill", "gain", TEXT, "text on gain fill"],
  ["on-fill", "loss", TEXT, "text on loss fill"],
  ["on-fill", "warn", TEXT, "text on warn fill"],
  ["input-border", "glass", UI, "input borders"],
  ["ring", "glass", UI, "focus ring on glass"],
  ["ring", "page", UI, "focus ring on page"],
  ["accent-fill", "glass", UI, "chart pin / primary button edge"],
  ["expected", "glass", UI, "expected marker"],
  ["target", "glass", UI, "target marker"],
  ...Array.from({ length: 8 }, (_, i) => [`subject-${i + 1}`, "glass", UI, `subject colour ${i + 1}`]),
];

let failed = 0;
const rows = [];
for (const [name, t] of Object.entries(themes)) {
  const c = (k) => {
    if (!(k in t)) throw new Error(`${name}: missing token --${k}`);
    return hsl(t[k]);
  };
  const page = c("background");
  const glowAlpha = Number(t["glow-alpha"] ?? 0);
  const glassAlpha = Number(t["glass-alpha"] ?? 1);
  // A glass surface can sit over the bare page or over the glow; check both.
  const unders = [page, mix(c("glow"), page, glowAlpha)];
  const bgs = (k) =>
    k === "page" ? unders : k === "glass" ? unders.map((u) => mix(c("surface"), u, glassAlpha)) : [c(k)];
  for (const [fg, bg, floor, label] of PAIRS) {
    const r = Math.min(...bgs(bg).map((b) => ratio(c(fg), b)));
    const ok = r >= floor;
    if (!ok) failed++;
    rows.push({ theme: name, pair: `${fg} on ${bg}`, label, ratio: r.toFixed(2), floor, ok: ok ? "ok" : "FAIL" });
  }
}

if (process.argv.includes("--table")) console.table(rows);
else for (const r of rows.filter((r) => r.ok !== "ok")) console.error(`FAIL ${r.theme}: ${r.pair} (${r.label}) ${r.ratio}:1 < ${r.floor}:1`);
const n = Object.keys(themes).length;
if (n < 3) { console.error(`expected at least 3 themes, found ${n}`); process.exit(1); }
if (failed) { console.error(`contrast: ${failed} pairing(s) below WCAG AA`); process.exit(1); }
console.log(`contrast: ${rows.length} pairings across ${n} themes all meet WCAG AA`);
