#!/usr/bin/env node
// Performance gate. Zero dependencies. Starting at the entry chunk named in
// dist/index.html, follows only *static* imports (dynamic import() is the
// lazy boundary) and fails if the critical graph is over budget or contains
// something that belongs behind a dynamic import.
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, relative } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;

// Ceilings for what the browser must download before first render (gzip).
const BUDGET = { js: 110_000, css: 16_000 };
// Source modules that must never be on the critical path. Matched against the
// module ids recorded per chunk by the chunk-map plugin in vite.config.ts —
// not chunk names, because a static import merges the module into the entry.
const MUST_BE_LAZY = [
  { name: "components/Guide.tsx", why: "the getting-started guide only loads for first-time visitors" },
  { name: "lib/liquidGlass.ts", why: "WebGL glass is a progressive enhancement started when the browser is idle" },
  { name: "ScalingTable", why: "course scaling reference is only needed on the How it works tab" },
  { name: "Syllabuses", why: "the syllabus directory is only needed on its tab" },
  { name: "syllabuses.json", why: "141 syllabus links are only needed on the Syllabuses tab" },
  { name: "components/Subjects.tsx", why: "the subjects editor is prefetched when idle, not needed for first paint" },
  { name: "components/CourseSearch.tsx", why: "course search lives in the lazy subjects editor" },
  { name: "components/HowItWorks.tsx", why: "the explainer tab is prefetched when idle" },
  { name: "dompurify", why: "sanitiser is only needed after an import" },
  { name: "firebase", why: "no Firebase SDK on the critical path" },
];

const html = readFileSync(join(dist, "index.html"), "utf8");
const entry = html.match(/<script type="module"[^>]*src="\/([^"]+\.js)"/)?.[1];
if (!entry) { console.error("check-budget: no module entry script in dist/index.html"); process.exit(1); }

const STATIC = /(?:^|[;{}\s])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g;
const seen = new Set();
const queue = [join(dist, entry)];
while (queue.length) {
  const f = queue.shift();
  if (seen.has(f)) continue;
  if (!existsSync(f)) { console.error(`check-budget: missing chunk ${relative(dist, f)}`); process.exit(1); }
  seen.add(f);
  for (const m of readFileSync(f, "utf8").matchAll(STATIC)) queue.push(join(dirname(f), m[1]));
}

const gz = (f) => gzipSync(readFileSync(f), { level: 9 }).length;
const jsFiles = [...seen];
const cssFiles = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/([^"]+\.css)"/g)].map((m) => join(dist, m[1]));
const js = jsFiles.reduce((a, f) => a + gz(f), 0);
const css = cssFiles.reduce((a, f) => a + gz(f), 0);

const fails = [];
if (js > BUDGET.js) fails.push(`critical JS is ${js} B gzip, budget ${BUDGET.js} B`);
if (css > BUDGET.css) fails.push(`critical CSS is ${css} B gzip, budget ${BUDGET.css} B`);
const metaFile = new URL("../.build-meta/chunks.json", import.meta.url).pathname;
if (!existsSync(metaFile)) { console.error("check-budget: .build-meta/chunks.json missing — build first"); process.exit(1); }
const chunkModules = JSON.parse(readFileSync(metaFile, "utf8"));
for (const f of jsFiles) {
  const name = relative(dist, f);
  const mods = chunkModules[name];
  if (!mods) { fails.push(`${name}: not in chunk map — stale .build-meta?`); continue; }
  for (const l of MUST_BE_LAZY)
    for (const m of mods.filter((m) => m.includes(l.name)))
      fails.push(`${m} is on the critical path (in ${name}) — ${l.why}; load it with import()`);
}

console.log(`critical path: ${jsFiles.length} JS chunk(s) ${(js / 1024).toFixed(1)} KiB gz, CSS ${(css / 1024).toFixed(1)} KiB gz`);
for (const f of jsFiles) console.log(`  ${relative(dist, f)}  ${(gz(f) / 1024).toFixed(1)} KiB`);
if (fails.length) { for (const f of fails) console.error(`FAIL ${f}`); process.exit(1); }
console.log("check-budget: ok");
