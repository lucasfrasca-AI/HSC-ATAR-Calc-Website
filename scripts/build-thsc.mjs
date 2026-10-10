#!/usr/bin/env node
// Generator: content/thsc.json — links to the school trial papers and internal assessment
// tasks listed on THSC Online (thsconline.github.io), Year 12 pages only. These are NOT NESA
// papers: they are schools' own exams, uploaded to THSC by students and teachers. Links only;
// nothing is copied. THSC's "HSC papers" pages are skipped: those are NESA's papers, which
// content/papers.json already links at the source.
//
// Each THSC entry is `pdf(this, <folder>)` with the link text as the title; THSC's viewer lives
// at /s/v/<folder>/<title with only [A-Za-z0-9._- ] kept> (see pdf() in their viewer.js). We
// build exactly that URL. School = the heading the entry is listed under on THSC.
//   node scripts/build-thsc.mjs
import { writeFileSync } from "node:fs";

const OUT = new URL("../content/thsc.json", import.meta.url);
const B = "https://thsconline.github.io";
const UA = { "user-agent": "hsc-atar-calc paper index (links only; https://hsc-atar-calc.web.app)" };

// THSC page → our course(s). Explicit, so a new or renamed THSC page fails loudly instead of
// landing on the wrong course. PDHPE → HMS follows NESA's own "previous course" link.
const MAP = {
  "Agriculture/trialpapers.html": ["Agriculture", ["agriculture"], "trial"],
  "Agriculture/assessment-tasks.html": ["Agriculture", ["agriculture"], "task"],
  "Ancient History/trialpapers.html": ["Ancient History", ["ancient"], "trial"],
  "Biology/trialpapers.html": ["Biology", ["biology"], "trial"],
  "Biology/assessment-tasks.html": ["Biology", ["biology"], "task"],
  "Business Studies/trialpapers.html": ["Business Studies", ["business"], "trial"],
  "Business Studies/assessment-tasks.html": ["Business Studies", ["business"], "task"],
  "Chemistry/trialpapers.html": ["Chemistry", ["chemistry"], "trial"],
  "Chemistry/assessment-tasks.html": ["Chemistry", ["chemistry"], "task"],
  "Earth & Environmental Science/trialpapers.html": ["Earth and Environmental Science", ["ees"], "trial"],
  "Society & Culture/trialpapers.html": ["Society and Culture", ["soc-cult"], "trial"],
  "Economics/trialpapers.html": ["Economics", ["economics"], "trial"],
  "Economics/assessment-tasks.html": ["Economics", ["economics"], "task"],
  "Engineering Studies/trialpapers.html": ["Engineering Studies", ["engineering"], "trial"],
  "Engineering Studies/assessment-tasks.html": ["Engineering Studies", ["engineering"], "task"],
  "English/trialpapers_paper1.html": ["English Standard and Advanced", ["eng-std", "eng-adv"], "trial", "Paper 1 (common)"],
  "English/trialpapers_paper2_advanced.html": ["English Advanced", ["eng-adv"], "trial", "Paper 2"],
  "English/trialpapers_paper2_standard.html": ["English Standard", ["eng-std"], "trial", "Paper 2"],
  "English/assessment-tasks.html": ["English Standard and Advanced", ["eng-std", "eng-adv"], "task"],
  "English Ext 1/trialpapers_extension1.html": ["English Extension 1", ["eng-ext1"], "trial"],
  "History Extension/trialpapers.html": ["History Extension", ["hist-ext"], "trial"],
  "Investigating Science/trialpapers.html": ["Investigating Science", ["inv-sci"], "trial"],
  "IPT/trialpapers.html": ["Information Processes and Technology", [], "trial"],
  "IPT/assessment-tasks.html": ["Information Processes and Technology", [], "task"],
  "Legal Studies/trialpapers.html": ["Legal Studies", ["legal"], "trial"],
  "Maths/trialpapers_general.html": ["Mathematics Standard", ["maths-std1", "maths-std2"], "trial"],
  "Maths/trialpapers_advanced.html": ["Mathematics Advanced", ["maths-adv"], "trial"],
  "Maths/trialpapers_extension1.html": ["Mathematics Extension 1", ["maths-ext1"], "trial"],
  "Maths/trialpapers_extension2.html": ["Mathematics Extension 2", ["maths-ext2"], "trial"],
  "Maths/assessment-tasks_general.html": ["Mathematics Standard", ["maths-std1", "maths-std2"], "task"],
  "Maths/assessment-tasks_advanced.html": ["Mathematics Advanced", ["maths-adv"], "task"],
  "Maths/assessment-tasks_extension1.html": ["Mathematics Extension 1", ["maths-ext1"], "task"],
  "Maths/assessment-tasks_extension2.html": ["Mathematics Extension 2", ["maths-ext2"], "task"],
  "Modern History/trialpapers.html": ["Modern History", ["modern"], "trial"],
  "PDHPE/trialpapers.html": ["PDHPE", ["hms"], "trial"],
  "Physics/trialpapers.html": ["Physics", ["physics"], "trial"],
  "Physics/assessment-tasks.html": ["Physics", ["physics"], "task"],
  "Software/trialpapers.html": ["Software Design and Development", [], "trial"],
  "Studies of Religion/trialpapers_sor1.html": ["Studies of Religion I", ["sor1"], "trial"],
  "Studies of Religion/trialpapers_sor2.html": ["Studies of Religion II", ["sor2"], "trial"],
  "Visual Arts/trialpapers.html": ["Visual Arts", ["visual-arts"], "trial"],
};
const SKIP = /^(hscpapers|qpapers|vcepapers|tcepapers)/;   // NESA copies, interstate papers

const get = async (p) => { const r = await fetch(B + p, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${p}`); return r.text(); };
const dec = (s) => s.replace(/&amp;/g, "&").replace(/&#160;|&nbsp;/g, " ").replace(/&#039;|&rsquo;/g, "'").replace(/\s+/g, " ").trim();
// THSC's own rule (viewer.js pdf()): keep (Adv.)/(Std.), drop anything outside [A-Za-z0-9._- ].
const thscTitle = (t) => t.replace(/\(Adv\.\)/g, "__ADV__").replace(/\(Std\.\)/g, "__STD__").replace(/[^A-Za-z0-9._\- ]/g, "").replace(/__ADV__/g, "(Adv.)").replace(/__STD__/g, "(Std.)");
const SOL = /\s*\bw\.?\s*sol(?:n|ns|utions?)?\.?/i;

const idx = await get("/s/yr12/");
const folders = [...new Set([...idx.matchAll(/href="([^"#?/][^"#?]*\/)"/g)].map((m) => m[1].replace(/&amp;/g, "&")).filter((h) => !h.startsWith("http") && h !== "../"))];
const groups = [], unknown = [], odd = [];
for (const f of folders) {
  const folder = dec(decodeURIComponent(f)).replace(/\/$/, "");
  const pages = [...new Set([...(await get(`/s/yr12/${encodeURI(f)}`)).matchAll(/href="([a-z0-9_-]+\.html)"/gi)].map((m) => m[1]))]
    .filter((p) => p !== "index.html" && !SKIP.test(p));
  for (const p of pages) {
    const key = `${folder}/${p}`;
    const html = await get(`/s/yr12/${encodeURI(f)}${p}`);
    const body = html.slice(html.indexOf("BEGIN CONTENT") > 0 ? html.indexOf("BEGIN CONTENT") : 0);
    const items = [];
    // Each school is one table row: a <summary> heading (or plain text before the first <br>), then its links.
    for (const row of body.matchAll(/<tr><td>([\s\S]*?)<\/td><\/tr>/g)) {
      const links = [...row[1].matchAll(/onClick="pdf\(this,\s*(\d+)\)">([^<]+)</g)];
      if (!links.length) continue;
      const head = dec((row[1].match(/<summary>([^<]*)<\/summary>/) ?? row[1].match(/^([^<]*)<br/))?.[1] ?? "");
      for (const [, folderNo, raw] of links) {
        const title = dec(raw);
        const year = +(title.match(/\b(19[89]\d|20[0-3]\d)\b/)?.[1] ?? 0) || null;
        // Normally the heading is the school. Some headings are categories ("Additional Practice
        // (Mock Trial Exams)"): then the school is the title's text before the year, and an entry
        // with no year names no school at all — never guess one.
        const underSchool = !!head && title.toLowerCase().startsWith(head.toLowerCase());
        const school = underSchool ? head : year ? title.slice(0, title.search(/\b(19[89]\d|20[0-3]\d)\b/)).trim() : "";
        const group = underSchool ? "" : head;
        if (head && !underSchool) odd.push(`${key}: "${title}" under "${head}" → school "${school || "(none)"}"`);
        const sol = SOL.test(title);
        const note = title.slice(school && title.toLowerCase().startsWith(school.toLowerCase()) ? school.length : 0)
          .replace(year ? String(year) : "", "").replace(SOL, "").replace(/^[\s,–—-]+|[\s,–—-]+$/g, "").replace(/\s+/g, " ");
        // THSC's pdf() uses the link's textContent (entities decoded, whitespace NOT collapsed), then trims.
        const raw2 = raw.replace(/&amp;/g, "&").replace(/&#160;|&nbsp;/g, "\u00a0").replace(/&#039;|&rsquo;/g, "'").trim();
        const t = thscTitle(raw2);
        if (t !== thscTitle(title)) console.error(`  whitespace-sensitive title kept exact: "${t}"`);
        if (items.some((x) => x.f === +folderNo && x.t === t)) continue;   // identical link on THSC too
        items.push({ school, year, sol, note, group, f: +folderNo, t });
      }
    }
    if (!items.length) continue;
    if (!MAP[key]) { unknown.push(`${key} (${items.length})`); continue; }
    const [name, courseIds, kind, section = ""] = MAP[key];
    items.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.school.localeCompare(b.school));
    groups.push({ name, courseIds, kind, section, page: `${B}/s/yr12/${encodeURI(f)}${p}`, items });
    console.error(`  ${key}: ${items.length} (${items.filter((i) => i.sol).length} with solutions)`);
  }
}
if (odd.length) console.error(`entries listed under a category heading, not a school (school read from the title instead):\n  ${odd.join("\n  ")}`);
if (unknown.length) { console.error(`THSC pages with no mapping — add them to MAP:\n  ${unknown.join("\n  ")}`); process.exit(1); }
// Compact form (it ships to browsers): an item is [school, year, sol, note, title]; title is null
// when THSC's title is exactly "school year[ note][ w. sol]" (rebuilt the same way in Papers.tsx).
// Groups whose items all share one THSC folder number store it once.
const rebuild = (i) => thscTitle([i.school, i.year, i.note, i.sol ? "w. sol" : ""].filter((x) => x !== "" && x !== null).join(" "));
for (const g of groups) {
  const fs = new Set(g.items.map((i) => i.f));
  g.f = fs.size === 1 ? [...fs][0] : null;
  g.items = g.items.map((i) => {
    const row = [i.school, i.year, i.sol ? 1 : 0, i.note, rebuild(i) === i.t ? null : i.t];
    return g.f === null ? [...row, i.f] : row;
  });
}
writeFileSync(OUT, JSON.stringify({
  source: "THSC Online (thsconline.github.io) — school trial papers and internal assessment tasks uploaded by students and teachers. Not NESA papers.",
  origin: B,
  generated: new Date().toISOString().slice(0, 10),
  groups,
}) + "\n");
const n = groups.reduce((a, g) => a + g.items.length, 0);
console.error(`wrote ${groups.length} groups, ${n} papers (${groups.reduce((a, g) => a + g.items.filter((i) => i[2]).length, 0)} with solutions)`);
