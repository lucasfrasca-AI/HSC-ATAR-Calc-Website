#!/usr/bin/env node
// One-off generator: content/courses.json from the researched NESA/UAC 2026
// HSC course list (kept outside this repo, see CLAUDE.md "Data provenance").
// Usage: node scripts/build-courses.mjs ~/sites/research/nesa-courses.json
//
// Scaling here is NOT UAC data. Each course gets the generic tier the original
// reference assigned it ("reference" source), or the generic "average" tier if
// the reference didn't list it ("default" source). Six courses carry the
// anchors supplied in the reference. All are labelled estimates in the UI.
import { readFileSync, writeFileSync } from "node:fs";

const src = JSON.parse(readFileSync(process.argv[2], "utf8"));

// From reference/nsw-hsc-atar-calculator-blank.html CATALOG: id, name in the
// 2026 list, generic tier, supplied anchors (blended -> scaled /100).
const REF = {
  "English Standard": ["eng-std", "low", [[67, 28.0], [73, 39.2], [77, 51.6], [81, 62.4], [88, 79.0]]],
  "English Advanced": ["eng-adv", "above"],
  "English as an Additional Language or Dialect": ["eng-eald", "average"],
  "English Studies (Examination)": ["eng-studies", "low"],
  "English Extension 1": ["eng-ext1", "strong"],
  "English Extension 2": ["eng-ext2", "strong"],
  "Mathematics Standard 1 (Examination)": ["maths-std1", "low"],
  "Mathematics Standard 2": ["maths-std2", "low", [[63, 28.8], [73, 44.6], [81, 61.8], [89, 74.6], [96, 86.4]]],
  "Mathematics Advanced": ["maths-adv", "above"],
  "Mathematics Extension 1": ["maths-ext1", "strong"],
  "Mathematics Extension 2": ["maths-ext2", "strong"],
  Biology: ["biology", "average"],
  Chemistry: ["chemistry", "strong"],
  Physics: ["physics", "strong"],
  "Earth and Environmental Science": ["ees", "average"],
  "Investigating Science": ["inv-sci", "below"],
  "Science Extension": ["sci-ext", "strong"],
  "Business Studies": ["business", "below", [[66, 28.4], [75, 47.0], [84, 65.6], [90, 78.0], [95, 90.8]]],
  Economics: ["economics", "strong"],
  "Legal Studies": ["legal", "average"],
  "Modern History": ["modern", "above"],
  "Ancient History": ["ancient", "average"],
  "History Extension": ["hist-ext", "strong"],
  Geography: ["geography", "average"],
  "Society and Culture": ["soc-cult", "average"],
  "Studies of Religion I": ["sor1", "low", [[70, 41.0], [78, 55.4], [84, 69.6], [90, 79.8], [98, 92.0]]],
  "Studies of Religion II": ["sor2", "average"],
  "Aboriginal Studies": ["aboriginal", "below"],
  "Health and Movement Science": ["hms", "low", [[67, 27.8], [75, 44.4], [83, 62.4], [90, 75.2], [94, 87.8]]],
  "Community and Family Studies": ["cafs", "below"],
  "Visual Arts": ["visual-arts", "below"],
  "Music 1": ["music1", "below"],
  "Music 2": ["music2", "above"],
  "Music Extension": ["music-ext", "strong"],
  Drama: ["drama", "average"],
  Dance: ["dance", "below"],
  "Design and Technology": ["dt", "below"],
  "Engineering Studies": ["engineering", "above"],
  "Software Engineering": ["software", "above"],
  "Enterprise Computing": ["enterprise", "below"],
  "Industrial Technology": ["ind-tech", "low"],
  "Food Technology": ["food-tech", "below"],
  "Textiles and Design": ["textiles", "below"],
  Agriculture: ["agriculture", "below"],
  "Italian Beginners": ["italian-beg", "low", [[69, 33.8], [80, 51.2], [90, 67.8], [93, 77.2], [99, 97.2]]],
  "Italian Continuers": ["italian-cont", "above"],
  "French Beginners": ["french-beg", "low"],
  "French Continuers": ["french-cont", "strong"],
  "Japanese Beginners": ["japanese-beg", "low"],
  "Japanese Continuers": ["japanese-cont", "strong"],
  "Spanish Beginners": ["spanish-beg", "low"],
  "Spanish Continuers": ["spanish-cont", "above"],
  "German Continuers": ["german-cont", "strong"],
  "Business Services (Examination)": ["vet-business", "low"],
  "Construction (Examination)": ["vet-construction", "low"],
  "Hospitality – Food and Beverage (Examination)": ["vet-hospitality", "low"],
  "Hospitality – Kitchen Operation and Cookery (Examination)": ["vet-hospitality-kitchen", "low"],
  "Information and Digital Technology (Examination)": ["vet-idt", "low"],
  "Retail Services (Examination)": ["vet-retail", "low"],
  "Human Services (Examination)": ["vet-human", "low"],
  "Primary Industries (Examination)": ["vet-primary", "low"],
  "Electrotechnology (Examination)": ["vet-electro", "low"],
  "Entertainment Industry (Examination)": ["vet-entertain", "low"],
  "Tourism, Travel and Events (Examination)": ["vet-tourism", "low"],
  "Automotive (Examination)": ["vet-auto", "low"],
};

const AREA = {
  HSIE: "Human Society and Its Environment",
  "Technological and Applied Studies": "Technological and Applied Studies",
  VET: "VET (examination courses)",
};
const slug = (s) => s.toLowerCase().replace(/\(examination\)/, "").replace(/[–—]/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const used = new Set();
const courses = src.courses.map((c) => {
  const name = c.course_name;
  const ref = REF[name];
  if (ref) used.add(name);
  const id = ref ? ref[0] : (c.learning_area === "VET" ? "vet-" : "") + slug(name);
  const english = c.learning_area === "English";
  const ext = !!c.is_extension;
  // Units: Maths Extension 1 is published as "1/2" (1 unit with Mathematics
  // Advanced, 2 with Extension 2); default to 1, the UI explains the rule.
  const units = c.units ?? (name === "Mathematics Extension 1" ? 1 : null);
  if (units !== 1 && units !== 2) throw new Error(`no unit value for ${name}`);
  let excl = null;
  if (["English Standard", "English Advanced", "English as an Additional Language or Dialect", "English Studies (Examination)"].includes(name)) excl = "english-main";
  else if (["Mathematics Standard 1 (Examination)", "Mathematics Standard 2", "Mathematics Advanced"].includes(name)) excl = "maths-main";
  else if (name.startsWith("Studies of Religion")) excl = "sor";
  else if (name === "Music 1" || name === "Music 2") excl = "music-main";
  else { const m = name.match(/^(.+) (Beginners|Continuers)$/); if (m && c.learning_area === "Languages") excl = `${slug(m[1])}-beg-cont`; }
  return {
    id, name, nesaCode: c.nesa_course_number,
    area: AREA[c.learning_area] ?? c.learning_area,
    units, english, extension: ext, excl,
    tier: ref ? ref[1] : "average",
    tierSource: ref ? "reference" : "default",
    anchors: ref?.[2] ?? null,
  };
});

const missing = Object.keys(REF).filter((n) => !used.has(n));
if (missing.length) throw new Error(`reference courses not in the 2026 list: ${missing.join(", ")}`);
const ids = courses.map((c) => c.id);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) throw new Error(`duplicate ids: ${dup}`);

courses.push({ id: "custom", name: "Other course (enter details)", nesaCode: null, area: "Other", units: 2, english: false, extension: false, excl: null, tier: "average", tierSource: "default", anchors: null });

const out = {
  source: {
    list: "UAC 2026 HSC courses list (ATAR courses), cross-checked with the 2025 list",
    url: src.primary_source,
    accessed: src.accessed,
    note: "Course names, NESA numbers and unit values only. Scaling tiers are generic estimates, not UAC data.",
  },
  courses,
};
writeFileSync(new URL("../content/courses.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`${courses.length} courses (${courses.filter((c) => c.tierSource === "reference").length} with reference tiers, ${courses.filter((c) => c.anchors).length} with supplied anchors)`);
