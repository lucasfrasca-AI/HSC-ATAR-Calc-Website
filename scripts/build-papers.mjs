#!/usr/bin/env node
// Generator: content/papers.json — direct links to every NESA HSC exam paper, marking
// guideline and transcript, current and archive. Links only; no NESA content is copied.
//
// Source: nsw.gov.au's public resource index (the same Elasticsearch endpoint the
// "HSC exam papers" page queries), then each course page, then each year page.
// Polite: 3 requests in flight, identified user agent. Re-run before each HSC season:
//   node scripts/build-papers.mjs
// Then verify every file link is live (weekly in CI): node scripts/build-papers.mjs --check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = new URL("../content/papers.json", import.meta.url);
const ORIGIN = "https://www.nsw.gov.au";
const BASE = "/education-and-training/nesa/curriculum/hsc-exam-papers/";
const UA = { "user-agent": "hsc-atar-calc paper index (links only; https://hsc-atar-calc.web.app)" };

async function pool(items, n, fn) {
  const q = [...items], out = [];
  await Promise.all(Array.from({ length: n }, async () => { for (let x = q.shift(); x !== undefined; x = q.shift()) out.push(await fn(x)); }));
  return out;
}
// Pages are cached for a day (outside the repo) so a re-run after a parser fix is quick.
const CACHE = process.env.PAPERS_CACHE ?? join(tmpdir(), "hsc-papers-cache");
mkdirSync(CACHE, { recursive: true });
async function get(path, tries = 3) {
  const file = join(CACHE, createHash("sha1").update(path).digest("hex"));
  if (existsSync(file) && Date.now() - (await import("node:fs")).statSync(file).mtimeMs < 864e5) return readFileSync(file, "utf8");
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(ORIGIN + path, { headers: UA });
      if (r.ok) { const txt = await r.text(); writeFileSync(file, txt); return txt; }
      if (i >= tries - 1) throw new Error(`${r.status} ${path}`);
    } catch (e) { if (i >= tries - 1) throw e; }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
}

if (process.argv[2] === "--check") {
  const { courses } = JSON.parse(readFileSync(OUT, "utf8"));
  const { files: prefix } = JSON.parse(readFileSync(OUT, "utf8"));
  const files = courses.flatMap((c) => c.years.flatMap(([, fs]) => fs.filter(([k]) => k !== "external").map(([, , , p]) => ORIGIN + (p.startsWith("/") ? p : prefix + p))));
  let bad = 0;
  await pool(files, 6, async (u) => {
    try {
      const r = await fetch(u, { method: "HEAD", headers: UA });
      if (!r.ok || !/pdf|octet|zip|audio|word/.test(r.headers.get("content-type") ?? "")) { bad++; console.error(`FAIL ${r.status} ${r.headers.get("content-type")} ${u}`); }
    } catch (e) { bad++; console.error(`FAIL ${u} (${e.message})`); }
  });
  console.log(`${files.length - bad}/${files.length} paper links live`);
  process.exit(bad ? 1 : 0);
}

const AREAS = ["English", "Mathematics", "Science", "HSIE", "Languages", "Creative Arts", "PDHPE", "Technological and Applied Studies", "VET"];

// 1. Every exam pack page (current + archive) from the public index.
const es = await fetch(`${ORIGIN}/api/v1/elasticsearch/prod_content/_search`, {
  method: "POST", headers: { ...UA, "content-type": "application/json" },
  body: JSON.stringify({ size: 1000, _source: ["url", "title_short", "name_resource_type", "name_category"],
    query: { bool: { filter: [{ terms: { name_resource_type: ["HSC exam pack", "Archive HSC exam pack"] } }] } } }),
}).then((r) => r.json());
const packs = es.hits.hits.map((h) => ({
  path: h._source.url[0], name: h._source.title_short[0].replace(/\s*\(Archive\)$/, ""),
  archive: h._source.name_resource_type[0].startsWith("Archive"),
  // NESA's own learning area (every pack has exactly one) — used to group courses like NESA and THSC do.
  area: AREAS.find((a) => h._source.name_category.includes(a)) ?? "Other",
})).filter((p) => p.path.startsWith(BASE));
console.error(`${packs.length} exam packs`);

const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#039;|&rsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const mainOf = (html) => html.slice(Math.max(0, html.indexOf("<main")), html.indexOf("</main>") > 0 ? html.indexOf("</main>") : undefined);
const kindOf = (label, path) =>
  /transcript/i.test(label) ? "transcript" : /marking guideline|-mg[.-]|-mg-/i.test(label + path) ? "mg"
  : /\.(mp3|wav|m4a)$/i.test(path) ? "audio" : /stimulus|source booklet|insert/i.test(label) ? "stimulus"
  : /exam|paper/i.test(label) ? "exam" : "other";

// 2. Year pages per pack, 3. file links per year page.
const courses = await pool(packs, 3, async (p) => {
  const page = await get(p.path);
  // Other exam packs this page points to (e.g. a new course's page links its predecessor's archive).
  const related = [...new Set([...mainOf(page).matchAll(/href="(?:https:\/\/www\.nsw\.gov\.au)?(\/education-and-training\/nesa\/curriculum\/hsc-exam-papers\/[a-z0-9-]+)"/g)].map((m) => m[1]))].filter((x) => x !== p.path && !x.startsWith(p.path + "-"));
  const years = [...new Set([...mainOf(page).matchAll(new RegExp(`href="(?:${ORIGIN})?(${p.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/((?:19|20)\\d\\d))"`, "g"))].map((m) => m[1]))];
  const out = [];
  for (const yp of years) {
    const html = mainOf(await get(yp));
    const files = [];
    for (const m of html.matchAll(/<a\b[^>]*href="((?:https:\/\/www\.nsw\.gov\.au)?\/sites\/default\/files\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const path = m[1].replace(ORIGIN, "").replace(/&amp;/g, "&");
      if (files.some((f) => f.path === path)) continue;
      const full = strip(m[2]);
      const size = full.match(/\((?:PDF|MP3|ZIP|DOCX?)[^)]*\)\s*$/i)?.[0].slice(1, -1) ?? "";
      const label = full.replace(/\s*\((?:PDF|MP3|ZIP|DOCX?)[^)]*\)\s*$/i, "");
      files.push({ kind: kindOf(label, path), label, size, path });
    }
    // Some language exams are set interstate; NESA links the other authority's papers instead.
    if (!files.length) for (const m of html.matchAll(/<a\b[^>]*href="(https:\/\/(?!www\.nsw\.gov\.au|facebook|twitter|www\.linkedin|services\.dcu)[^"]+)"[^>]*>([\s\S]*?)<\/a>/g))
      if (!files.some((f) => f.path === m[1])) files.push({ kind: "external", label: strip(m[2]), size: "", path: m[1].replace(/&amp;/g, "&") });
    if (files.length) out.push({ year: +yp.slice(-4), page: yp, files });
  }
  out.sort((a, b) => b.year - a.year);
  console.error(`  ${p.name}${p.archive ? " (archive)" : ""}: ${out.length} years, ${out.reduce((a, y) => a + y.files.length, 0)} files`);
  return { slug: p.path.slice(BASE.length), name: p.name, area: p.area, archive: p.archive, page: p.path, years: out, related };
});

// Link each pack to our catalogue course where the names agree, so "your subjects" sort first.
const norm = (s) => s.toLowerCase().replace(/\(examination\)/g, "").replace(/[–—-]/g, " ").replace(/&/g, "and").replace(/[,()]/g, "").replace(/\s+/g, " ").trim();
const { courses: catalog } = JSON.parse(readFileSync(new URL("../content/courses.json", import.meta.url), "utf8"));
const byName = new Map(catalog.map((c) => [norm(c.name), c.id]));
// Renamed or split courses (facts about the HSC, not guesses): Mathematics → Mathematics Advanced and
// Mathematics General → Mathematics Standard from 2019; NESA lists Standard 1/2 and SOR I/II as one pack.
const ALIAS = {
  "Mathematics": ["maths-adv"], "Mathematics General": ["maths-std1", "maths-std2"], "Mathematics Standard": ["maths-std1", "maths-std2"],
  "Studies of Religion": ["sor1", "sor2"], "Hospitality": ["vet-hospitality", "vet-hospitality-kitchen"],
};
for (const c of courses) c.courseIds = ALIAS[c.name] ?? (byName.has(norm(c.name)) ? [byName.get(norm(c.name))] : []);
// A pack with no papers yet that points at another pack (HMS → PDHPE archive): that pack is its predecessor.
for (const c of courses) if (!c.years.length) for (const r of c.related) {
  const prev = courses.find((x) => x.page === r);
  if (!prev || !c.courseIds.length) continue;
  prev.courseIds = [...new Set([...prev.courseIds, ...c.courseIds])];
  if (norm(prev.name) !== norm(c.name)) prev.successor = c.name;   // its own archive is not a predecessor
}
for (const c of courses) delete c.related;

courses.sort((a, b) => a.name.localeCompare(b.name) || Number(a.archive) - Number(b.archive));
const kept = courses.filter((c) => c.years.length);
// Compact form (it ships to browsers): year page = pack page + /year; NESA files drop the shared
// /sites/default/files/ prefix; a file is [kind, part, size, path] where part is the label's
// "– Paper 1" tail (or the full label for external links), the only bit the UI shows.
const FILES = "/sites/default/files/";
for (const c of kept) c.years = c.years.map((y) => [y.year, y.files.map((f) => [
  f.kind, f.kind === "external" ? f.label : f.label.split(/\s[–—-]\s/).slice(1).join(" – "), f.size.replace(/^PDF\s*/i, ""),
  f.kind === "external" ? f.path : f.path.startsWith(FILES) ? f.path.slice(FILES.length) : f.path,
])]);
writeFileSync(OUT, JSON.stringify({
  source: "NSW Education Standards Authority (NESA), HSC exam papers — https://www.nsw.gov.au/education-and-training/nesa/curriculum/hsc-exam-papers",
  origin: ORIGIN,
  files: FILES,
  generated: new Date().toISOString().slice(0, 10),
  courses: kept,
}) + "\n");
const nFiles = kept.reduce((a, c) => a + c.years.reduce((b, y) => b + y[1].length, 0), 0);
console.error(`wrote ${kept.length} courses, ${nFiles} files; ${kept.filter((c) => !c.courseIds.length).length} without a catalogue match`);
