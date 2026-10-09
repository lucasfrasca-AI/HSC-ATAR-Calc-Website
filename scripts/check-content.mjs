#!/usr/bin/env node
// Asserts the things that are invisible when broken. Zero dependencies.
// Run after `vite build`. Add a check here whenever a bug ships that CI could
// have caught (see CLAUDE.md "Traps").
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const p = (...a) => join(root, ...a);
const read = (f) => readFileSync(p(f), "utf8");
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

// ---- built page ------------------------------------------------------------
check(existsSync(p("dist/index.html")), "dist/index.html missing — run the build first");
const html = existsSync(p("dist/index.html")) ? read("dist/index.html") : "";

const required = [
  [/<html[^>]+lang="[a-z]{2}(-[A-Z]{2})?"/, "<html lang>"],
  [/<meta charset="utf-8"/i, "meta charset"],
  [/<meta name="viewport"[^>]+width=device-width/, "meta viewport"],
  [/<title>[^<%]{5,}<\/title>/, "non-empty <title>"],
  [/<meta name="description" content="[^"%]{30,}"/, "meta description (30+ chars)"],
  [/<link rel="icon"[^>]+href="\/favicon-32\.png"/, "favicon link"],
];
for (const [re, what] of required) check(re.test(html), `index.html: missing ${what}`);

// Readable without JS: the static fallback must be inside #root.
check(/<div id="root"><main class="fallback"><h1>[^<]+<\/h1>/.test(html), "index.html: no-JS fallback content missing from #root");

// No unreplaced template markers or placeholder copy.
const PLACEHOLDER = /%(TITLE|DESCRIPTION|LANG)%|<!--FALLBACK-->|lorem ipsum|\bTODO\b|\bTBD\b|\bFIXME\b|\bxxx+\b|example\.com/i;
check(!PLACEHOLDER.test(html), `index.html: placeholder text shipped (${html.match(PLACEHOLDER)?.[0]})`);
for (const f of readdirSync(p("content")).filter((f) => f.endsWith(".json"))) {
  const txt = read(`content/${f}`);
  check(!PLACEHOLDER.test(txt), `content/${f}: placeholder text (${txt.match(PLACEHOLDER)?.[0]})`);
  try { JSON.parse(txt); } catch (e) { fails.push(`content/${f}: invalid JSON (${e.message})`); }
}

// Hidden files survive the build (and, in CI, the artifact round-trip).
check(existsSync(p("dist/.well-known/security.txt")), "dist/.well-known/security.txt missing");

// ---- CSP ↔ inline scripts --------------------------------------------------
const fb = JSON.parse(read("firebase.json"));
const hosting = fb.hosting;
const allHeaders = hosting.headers.flatMap((h) => h.headers.map((x) => ({ ...x, source: h.source ?? h.regex })));
const header = (k) => allHeaders.find((h) => h.key.toLowerCase() === k.toLowerCase() && h.source === "**")?.value;
const csp = header("Content-Security-Policy") ?? "";
const scriptSrc = csp.split(";").map((s) => s.trim()).find((d) => d.startsWith("script-src")) ?? "";

const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
check(inline.length > 0, "expected the inline theme script in index.html");
for (const body of inline) {
  const h = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
  check(scriptSrc.includes(h), `CSP script-src lacks hash ${h} for an inline script — it will be blocked`);
}
check(scriptSrc && !scriptSrc.includes("unsafe-inline"), "CSP script-src must not allow 'unsafe-inline'");
check(/frame-ancestors 'none'/.test(csp), "CSP missing frame-ancestors 'none'");
check(/default-src 'self'/.test(csp), "CSP missing default-src 'self'");
for (const k of ["X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"])
  check(header(k), `firebase.json: missing site-wide ${k} header`);

// Firebase traps (CLAUDE.md).
check(hosting.cleanUrls !== true, "firebase.json: cleanUrls breaks per-path headers — use explicit redirects");
check(!(hosting.ignore ?? []).some((g) => g === "**/.*" || g === ".*"), "firebase.json: ignore pattern drops .well-known");
// Firebase compiles header/redirect regexes with RE2: no lookaround, no backreferences.
for (const r of [...(hosting.headers ?? []), ...(hosting.redirects ?? []), ...(hosting.rewrites ?? [])].map((h) => h.regex).filter(Boolean))
  check(!/\(\?<?[=!]|\\[1-9]/.test(r), `firebase.json: regex ${r} uses syntax RE2 rejects (lookaround/backreference)`);
check(hosting.public === "dist", "firebase.json: hosting.public must be dist");

// No data: URIs anywhere in the built output — the CSP has no data: source.
const distFiles = existsSync(p("dist")) ? walk(p("dist")) : [];
for (const f of distFiles.filter((f) => /\.(html|css|js)$/.test(f))) {
  const txt = readFileSync(f, "utf8");
  if (/url\(\s*["']?data:/.test(txt) || /src="data:/.test(txt)) fails.push(`${relative(root, f)}: data: URI blocked by CSP`);
}

// ---- source rules ----------------------------------------------------------
const src = walk(p("src")).filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith("styles/tokens.css"));
for (const f of src) {
  const txt = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const hex = txt.match(/#[0-9a-fA-F]{3,8}\b/);
  if (hex) fails.push(`${relative(root, f)}: colour literal ${hex[0]} — use a token`);
  const rgb = txt.match(/\b(rgba?|hsla?)\(\s*\d/);
  if (rgb) fails.push(`${relative(root, f)}: colour literal ${rgb[0]}… — use a token`);
  if (f.endsWith(".tsx")) {
    for (const m of txt.matchAll(/>([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)<\//g))
      fails.push(`${relative(root, f)}: hardcoded copy "${m[1].trim()}" — move it to content/*.json`);
  }
}

// Theme ids agree everywhere: content picker, token blocks, pre-paint script.
const site = JSON.parse(read("content/site.json"));
const pickerIds = site.theme.options.map((o) => o.id).sort();
const tokenIds = [...read("src/styles/tokens.css").matchAll(/data-theme="([^"]+)"/g)].map((m) => m[1]).sort();
const scriptIds = JSON.parse(read("index.html").match(/var v=(\[[^\]]+\])/)?.[1] ?? "[]").sort();
check(JSON.stringify(pickerIds) === JSON.stringify(tokenIds), `theme ids differ: picker ${pickerIds} vs tokens ${tokenIds}`);
check(JSON.stringify(pickerIds) === JSON.stringify(scriptIds), `theme ids differ: picker ${pickerIds} vs index.html ${scriptIds}`);

// Every message key the engine can emit has copy (a missing one renders the raw key).
const messages = JSON.parse(read("content/messages.json"));
const emitted = [...new Set([...read("src/lib/engine.ts").matchAll(/"((?:subject|task|elig)\.[A-Za-z0-9]+)"/g)].map((m) => m[1]))];
for (const k of emitted) check(k in messages, `content/messages.json: no copy for message key ${k}`);
check(emitted.length > 20, `expected the engine to emit 20+ message keys, found ${emitted.length}`);

// ---- asset budgets ---------------------------------------------------------
const LIMITS = [
  [/\.(png|jpe?g|webp|avif|gif)$/, 50_000, "image"],
  [/\.woff2$/, 40_000, "font"],
];
let total = 0;
for (const f of distFiles) {
  const size = statSync(f).size;
  total += size;
  for (const [re, max, kind] of LIMITS)
    if (re.test(f) && size > max) fails.push(`${relative(root, f)}: ${kind} is ${size} B, budget ${max} B`);
}
check(total < 1_500_000, `dist is ${total} B, budget 1.5 MB`);

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-content: ${fails.length} failure(s)`);
  process.exit(1);
}
console.log(`check-content: ok (${distFiles.length} files, ${(total / 1024).toFixed(0)} KiB)`);
