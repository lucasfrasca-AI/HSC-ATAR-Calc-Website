#!/usr/bin/env node
// One-off generator: content/syllabuses.json — links to each course's official
// NESA syllabus (or VET Industry Curriculum Framework). Links only; no NESA
// content is copied. Reads the curriculum pages saved during research:
//   node scripts/build-syllabuses.mjs ~/sites/research/raw
// Then verify every link is live: node scripts/build-syllabuses.mjs --check
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../content/syllabuses.json", import.meta.url);

if (process.argv[2] === "--check") {
  const { syllabuses } = JSON.parse(readFileSync(OUT, "utf8"));
  const urls = [...new Set(Object.values(syllabuses).flat().map((s) => s.url))];
  let bad = 0;
  const queue = [...urls];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      try {
        const r = await fetch(u, { redirect: "follow", headers: { "user-agent": "hsc-atar-calc link check" } });
        const landed = new URL(r.url);
        // NESA's dead links redirect to the NESA home page rather than 404.
        const homeRedirect = landed.pathname.replace(/\/$/, "") === "/education-and-training/nesa" || landed.pathname === "/";
        if (!r.ok || homeRedirect) { bad++; console.error(`FAIL ${r.status} ${u} -> ${r.url}`); }
      } catch (e) { bad++; console.error(`FAIL ${u} (${e.message})`); }
    }
  }));
  console.log(`${urls.length - bad}/${urls.length} syllabus links live`);
  process.exit(bad ? 1 : 0);
}

const dir = process.argv[2];
const rows = new Map();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  const h = readFileSync(join(dir, f), "utf8");
  for (const m of h.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>((?:(?!<\/a>)[\s\S]){0,3000})<\/a>/g)) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const t = text.match(/^(.*?) (Stage 6|11–12) \(((?:19|20)\d\d)\)/);
    if (!t || /Life Skills|CEC|Content Endorsed/i.test(text)) continue;
    const url = m[1].replace(/&amp;/g, "&");
    rows.set(t[0], { title: t[0], base: t[1], year: +t[3], url: url.startsWith("/") ? `https://curriculum.nsw.edu.au${url}` : url });
  }
  for (const m of h.matchAll(/href="(https:\/\/www\.nsw\.gov\.au\/education-and-training\/nesa\/curriculum\/vet\/stage-6-industry-curriculum-frameworks\/([a-z-]+))"/g)) {
    const base = m[2].split("-").map((w) => (w === "and" ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
    rows.set(`vet:${m[2]}`, { title: `${base} — Industry Curriculum Framework`, base, year: null, url: m[1], vet: true });
  }
}

const norm = (s) => s.toLowerCase().replace(/\(examination\)/, "").replace(/[–—-]/g, " ").replace(/&/g, "and").replace(/,/g, "").replace(/\s+/g, " ").trim();
const ALIAS = {
  "English as an Additional Language or Dialect": ["English EAL/D"],
  "English Extension 1": ["English Extension", "English Extension 1"],
  "English Extension 2": ["English Extension", "English Extension 2"],
  "Mathematics Standard 1 (Examination)": ["Mathematics Standard"],
  "Mathematics Standard 2": ["Mathematics Standard"],
  "Hospitality – Food and Beverage (Examination)": ["Hospitality"],
  "Hospitality – Kitchen Operation and Cookery (Examination)": ["Hospitality"],
};
const { courses } = JSON.parse(readFileSync(new URL("../content/courses.json", import.meta.url), "utf8"));
const out = {}, missing = [];
for (const c of courses.filter((c) => c.id !== "custom")) {
  const keys = (ALIAS[c.name] ?? [c.name]).map(norm);
  const hits = [...rows.values()].filter((r) => keys.includes(norm(r.base)) && (c.area.startsWith("VET") === !!r.vet));
  if (!hits.length) { missing.push(c.name); continue; }
  out[c.id] = hits.sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).map(({ title, year, url, vet }) => ({ title, year, url, ...(vet ? { kind: "framework" } : {}) }));
}
if (missing.length) { console.error(`no syllabus link for: ${missing.join("; ")}`); process.exit(1); }
writeFileSync(OUT, JSON.stringify({
  source: "Syllabus and Industry Curriculum Framework pages linked from NESA's NSW Curriculum website (curriculum.nsw.edu.au) and nsw.gov.au/nesa. Links only; content remains © NSW Education Standards Authority.",
  syllabuses: out,
}, null, 2) + "\n");
console.log(`${Object.keys(out).length} courses linked, ${Object.values(out).flat().length} links`);
