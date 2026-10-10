// Past papers, from two sources kept apart:
//  • NESA — every official HSC exam, linked straight to the PDF on nsw.gov.au
//    (content/papers.json, scripts/build-papers.mjs, checked weekly).
//  • THSC Online — schools' own trial papers and assessment tasks, linked to THSC's viewer
//    (content/thsc.json, scripts/build-thsc.mjs). Not NESA papers; loaded only when opened.
// Both are grouped by NESA's learning areas, with the student's own subjects first.
// Lazy — check-budget fails the build if any of this reaches the critical path.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import data from "../../content/papers.json";
import ui from "../../content/papers-ui.json";
import site from "../../content/site.json";
import { read, write } from "../lib/storage.ts";
import { useCalc } from "../lib/state.tsx";
import { t } from "../lib/text.ts";
import { Glass, Section } from "./ui.tsx";

type Kind = keyof typeof ui.kinds;
type Area = keyof typeof ui.areas;
interface File { kind: string; part: string; size: string; url: string }
interface Year { year: number; page: string; files: File[] }
/** Compact JSON (see build-papers.mjs): years are [year, [kind, part, size, path][]]. */
interface Pack { name: string; area: string; archive: boolean; page: string; courseIds: string[]; successor?: string; years: [number, [string, string, string, string][]][] }
interface Course { name: string; area: Area; courseIds: string[]; successor?: string; years: (Year & { old: boolean })[] }
interface ThscItem { school: string; year: number | null; sol: boolean; note: string; group: string; f: number; t: string }
interface ThscGroup { name: string; courseIds: string[]; kind: "trial" | "task"; section: string; page: string; items: ThscItem[] }
type ThscRow = [string, number | null, 0 | 1, string, string | null, number?];
interface ThscData { origin: string; generated: string; groups: (Omit<ThscGroup, "items"> & { f: number | null; items: ThscRow[] })[] }
// THSC's own title rule (viewer.js pdf(), mirrored in build-thsc.mjs): keep (Adv.)/(Std.), drop anything outside [A-Za-z0-9._- ].
const thscTitle = (t: string) => t.replace(/\(Adv\.\)/g, "__ADV__").replace(/\(Std\.\)/g, "__STD__").replace(/[^A-Za-z0-9._\- ]/g, "").replace(/__ADV__/g, "(Adv.)").replace(/__STD__/g, "(Std.)");
/** Expand the compact THSC rows; a null title is exactly "school year[ note][ w. sol]". */
const expand = (g: ThscData["groups"][number]): ThscGroup => ({
  ...g,
  items: g.items.map(([school, year, sol, note, title, f]) => ({
    school, year, sol: !!sol, note, group: "", f: f ?? g.f!,
    t: title ?? thscTitle([school, year, note, sol ? "w. sol" : ""].filter((x) => x !== "" && x !== null).join(" ")),
  })),
});
interface ThscCourse { name: string; area: Area; courseIds: string[]; page: string; groups: ThscGroup[] }

const AREA_ORDER = Object.keys(ui.areas) as Area[];
const DONE_KEY = "hsc-papers-done";
const ORIGIN = data.origin;

// One NESA card per course: current and old-syllabus packs merged, newest year first.
const COURSES: Course[] = (() => {
  const by = new Map<string, Course>();
  for (const p of data.courses as unknown as Pack[]) {
    // NESA's titles vary in case between current and archive packs ("Dutch continuers").
    const key = p.name.toLowerCase();
    const c = by.get(key) ?? { name: p.name, area: (p.area in ui.areas ? p.area : "Other") as Area, courseIds: [], years: [] };
    if (!p.archive) c.name = p.name;
    c.courseIds = [...new Set([...c.courseIds, ...p.courseIds])];
    c.successor ??= p.successor;
    c.years.push(...p.years.map(([year, fs]) => ({
      year, page: `${p.page}/${year}`, old: p.archive,
      files: fs.map(([kind, part, size, path]) => ({ kind, part, size, url: kind === "external" || path.startsWith("http") ? path : ORIGIN + (path.startsWith("/") ? path : data.files + path) })),
    })));
    by.set(key, c);
  }
  for (const c of by.values()) c.years.sort((a, b) => b.year - a.year || Number(a.old) - Number(b.old));
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
})();
/** A THSC course takes the learning area of the NESA course it shares a course id or name with. */
const areaFor = (name: string, ids: string[]): Area =>
  COURSES.find((c) => c.courseIds.some((id) => ids.includes(id)) || c.name.toLowerCase() === name.toLowerCase())?.area ?? "Other";

const loadDone = (): Set<string> => { try { return new Set(JSON.parse(read(DONE_KEY) ?? "[]") as string[]); } catch { return new Set(); } };

const Pdf = () => (
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
  </svg>
);
const Chev = () => (
  <svg aria-hidden="true" className="chev shrink-0 text-foreground-3" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
);

/** A disclosure card whose body only renders while open (long lists stay cheap). */
function Card({ id, open, setOpen, head, children }: { id: string; open: Set<string>; setOpen: (s: Set<string>) => void; head: ReactNode; children: () => ReactNode }) {
  const isOpen = open.has(id);
  return (
    <Glass as="details" className="glass-sm paper-course" open={isOpen}
      onToggle={(e: React.SyntheticEvent<HTMLDetailsElement>) => {
        const o = e.currentTarget.open;
        if (o === isOpen) return;
        const next = new Set(open); if (o) next.add(id); else next.delete(id); setOpen(next);
      }}>
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3.5"><span className="min-w-0 flex-1">{head}</span><Chev /></summary>
      {isOpen && children()}
    </Glass>
  );
}

function NesaYear({ c, y, done, toggle }: { c: Course; y: Course["years"][number]; done: Set<string>; toggle: (k: string) => void }) {
  const key = y.files.find((f) => f.kind === "exam")?.url ?? y.page;
  return (
    <li className="paper-year">
      <label className="paper-tick" title={t(ui.markDone, { year: y.year })}>
        <input type="checkbox" checked={done.has(key)} onChange={() => toggle(key)} aria-label={`${t(ui.markDone, { year: y.year })} (${c.name})`} />
      </label>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[0.92rem] font-semibold num">{y.year}{y.old && <span className="pill">{ui.oldSyllabus}</span>}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {y.files.map((f) => {
            const ext = f.kind === "external";
            const name = ext ? t(ui.external, { site: f.part }) : ui.kinds[f.kind as Kind] ?? ui.kinds.other;
            const sub = ext ? "" : f.part;
            return (
              <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" className={`paper-link ${f.kind === "exam" ? "paper-link-primary" : ""}`}>
                <Pdf /><span>{name}{sub && ` · ${sub}`}</span>
                {f.size && <span className="paper-size">{f.size}</span>}
                <span className="sr-only">{` ${c.name} ${y.year} `}{ext ? ui.opensExternal : ui.opensNew}</span>
              </a>
            );
          })}
          <a href={ORIGIN + y.page} target="_blank" rel="noopener noreferrer" className="paper-link paper-link-quiet"><span>{ui.feedback}</span><span className="sr-only">{ui.opensPage}</span></a>
        </div>
      </div>
    </li>
  );
}

/** THSC papers for one course and kind, listed by school like THSC lists them. */
function ThscList({ origin, groups, solOnly, kindWord }: { origin: string; groups: ThscGroup[]; solOnly: boolean; kindWord: string }) {
  return (
    <>
      {groups.map((g) => {
        const items = g.items.filter((i) => !solOnly || i.sol);
        const bySchool = new Map<string, ThscItem[]>();
        for (const i of items) bySchool.set(i.school, [...(bySchool.get(i.school) ?? []), i]);
        const schools = [...bySchool.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
        return (
          <div key={`${g.kind}-${g.section}`} className="mt-2">
            {g.section && <p className="kicker mt-3 mb-1">{g.section}</p>}
            <ul>
              {schools.map((s) => (
                <li key={s || "none"} className="paper-school">
                  <p className="text-[0.86rem] font-semibold">{s || ui.noSchool}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {[...bySchool.get(s)!].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.note.localeCompare(b.note)).map((i) => (
                      <a key={`${i.f}/${i.t}`} href={`${origin}/s/v/${i.f}/${encodeURI(i.t)}`} target="_blank" rel="noopener noreferrer" className="paper-link">
                        {i.year !== null && <span className="num">{i.year}</span>}{i.note && <span>{i.year !== null ? "· " : ""}{i.note}</span>}
                        {i.sol && <span className="paper-sol">{ui.solutions}</span>}
                        <span className="sr-only">{` — ${t(ui.thscPaper, { school: s || ui.noSchool, year: i.year ?? "", kind: kindWord })}${i.sol ? `, ${ui.withSol}` : ""} ${ui.thscOpens}`}</span>
                      </a>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function ThscCard({ c, origin, open, setOpen, solOnly, mine }: { c: ThscCourse; origin: string; open: Set<string>; setOpen: (s: Set<string>) => void; solOnly: boolean; mine: boolean }) {
  const trials = c.groups.filter((g) => g.kind === "trial"), tasks = c.groups.filter((g) => g.kind === "task");
  const count = (gs: ThscGroup[]) => gs.reduce((a, g) => a + g.items.filter((i) => !solOnly || i.sol).length, 0);
  const n = count(c.groups), s = c.groups.reduce((a, g) => a + g.items.filter((i) => i.sol).length, 0);
  const [kind, setKind] = useState<"trial" | "task">(trials.length ? "trial" : "task");
  return (
    <Card id={`thsc:${c.name}`} open={open} setOpen={setOpen}
      head={<>
        <span className="flex flex-wrap items-center gap-2"><b className="text-[0.98rem] font-semibold">{c.name}</b>{mine && <span className="pill !border-accent/50 !text-accent">{ui.mine}</span>}</span>
        <span className="mt-0.5 block text-[0.76rem] text-foreground-3">{n === 1 ? ui.thscCount1 : t(ui.thscCount, { n, s: solOnly ? n : s })}</span>
      </>}>
      {() => (
        <div className="border-t border-border/10 px-4 pt-3 pb-4">
          {trials.length > 0 && tasks.length > 0 && (
            <div className="seg mb-1" role="group" aria-label={ui.kindLabel}>
              <button type="button" className="btn" aria-pressed={kind === "trial"} onClick={() => setKind("trial")}>{ui.trials} <span className="num text-foreground-3">{count(trials)}</span></button>
              <button type="button" className="btn" aria-pressed={kind === "task"} onClick={() => setKind("task")}>{ui.tasks} <span className="num text-foreground-3">{count(tasks)}</span></button>
            </div>
          )}
          <ThscList origin={origin} groups={kind === "trial" ? trials : tasks} solOnly={solOnly} kindWord={kind === "trial" ? ui.trialWord : ui.taskWord} />
          <a href={c.page} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[0.8rem] text-accent underline underline-offset-2">{ui.thscViewAll}<span className="sr-only"> {ui.thscOpens}</span></a>
        </div>
      )}
    </Card>
  );
}

export default function Papers() {
  const { data: calc } = useCalc();
  const [source, setSource] = useState<"nesa" | "thsc">("nesa");
  const [q, setQ] = useState("");
  const [area, setArea] = useState<Area | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [old, setOld] = useState(false);
  const [solOnly, setSolOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [done, setDone] = useState(loadDone);
  const [thsc, setThsc] = useState<ThscData | null>(null);
  const mine = useMemo(() => new Set(calc.subjects.map((s) => s.courseId)), [calc.subjects]);
  const isMine = useCallback((ids: string[]) => ids.some((id) => mine.has(id)), [mine]);

  // THSC's index is its own chunk, fetched the first time that view is chosen.
  useEffect(() => {
    if (source !== "thsc" || thsc) return;
    let live = true;
    void import("../../content/thsc.json").then((m) => { if (live) setThsc(m.default as unknown as ThscData); });
    return () => { live = false; };
  }, [source, thsc]);

  const toggle = (k: string) => {
    const next = new Set(done);
    if (next.has(k)) next.delete(k); else next.add(k);
    setDone(next);
    write(DONE_KEY, JSON.stringify([...next]));
  };
  const words = useMemo(() => q.toLowerCase().split(/\s+/).filter(Boolean), [q]);
  const match = useCallback((name: string, ids: string[], a: Area) =>
    (!area || a === area) && (!mineOnly || isMine(ids)) && words.every((w) => name.toLowerCase().includes(w)), [area, mineOnly, isMine, words]);

  const nesa = useMemo(() => COURSES
    .map((c) => ({ ...c, years: old ? c.years : c.years.filter((y) => !y.old) }))
    .filter((c) => c.years.length && match(`${c.name} ${c.successor ?? ""}`, c.courseIds, c.area)), [old, match]);
  const thscCourses = useMemo(() => {
    if (!thsc) return [];
    const by = new Map<string, ThscCourse>();
    for (const g of thsc.groups.map(expand)) {
      const c = by.get(g.name) ?? { name: g.name, area: areaFor(g.name, g.courseIds), courseIds: g.courseIds, page: g.page, groups: [] };
      c.groups.push(g);
      by.set(g.name, c);
    }
    return [...by.values()].filter((c) => match(c.name, c.courseIds, c.area) && (!solOnly || c.groups.some((g) => g.items.some((i) => i.sol))))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [thsc, match, solOnly]);

  const areasPresent = AREA_ORDER.filter((a) => (source === "nesa" ? COURSES : thscCourses).some((c) => c.area === a));
  // Grouped like NESA and THSC group them — every learning area complete (all the maths courses
  // under Mathematics). Your subjects lead within their area, and areas holding them come first.
  const sections = <T extends { area: Area; courseIds: string[] }>(list: T[]) =>
    AREA_ORDER.map((a) => {
      const items = list.filter((c) => c.area === a).sort((x, y) => Number(isMine(y.courseIds)) - Number(isMine(x.courseIds)));
      return { key: a, title: ui.areas[a], items, mine: items.some((c) => isMine(c.courseIds)) };
    }).filter((s) => s.items.length).sort((x, y) => Number(y.mine) - Number(x.mine));
  const list = source === "nesa" ? nesa : thscCourses;
  const nesaCard = (c: Course) => {
    const n = c.years.length, nDone = c.years.filter((y) => done.has(y.files.find((f) => f.kind === "exam")?.url ?? y.page)).length;
    const from = c.years.at(-1)!.year, to = c.years[0]!.year;
    return (
      <Card id={`nesa:${c.name}`} open={open} setOpen={setOpen}
        head={<>
          <span className="flex flex-wrap items-center gap-2"><b className="text-[0.98rem] font-semibold">{c.name}</b>{isMine(c.courseIds) && <span className="pill !border-accent/50 !text-accent">{ui.mine}</span>}</span>
          <span className="mt-0.5 block text-[0.76rem] text-foreground-3">
            {t(from === to ? ui.year1 : ui.years, { from, to })} · {t(n === 1 ? ui.papers1 : ui.papers, { n })}
            {nDone > 0 && <> · <span className="text-gain">{t(ui.done, { d: nDone, n })}</span></>}
            {c.successor && <span className="block">{t(ui.predecessor, { name: c.successor })}</span>}
          </span>
        </>}>
        {() => <ul className="border-t border-border/10 px-4 pb-3">{c.years.map((y) => <NesaYear key={`${y.year}-${y.old}`} c={c} y={y} done={done} toggle={toggle} />)}</ul>}
      </Card>
    );
  };

  return (
    <Section id="papers" kicker={site.kickers.papers} title={ui.title} intro={ui.intro}>
      <div className="seg seg-lg mb-4" role="group" aria-label={ui.sourceLabel}>
        {(["nesa", "thsc"] as const).map((s) => (
          <button key={s} type="button" className="btn" aria-pressed={source === s} onClick={() => { setSource(s); setArea(null); }}>{ui.sources[s]}</button>
        ))}
      </div>
      {source === "thsc" && <p className="thsc-note mb-4 max-w-[80ch] border-l-2 border-warn/70 pl-3 text-[0.84rem] text-foreground-2">{ui.thscNote}</p>}
      <Glass className="glass-sm mb-4 flex flex-wrap items-end gap-x-5 gap-y-3 p-4">
        <label className="field min-w-[240px] flex-[2_1_280px]">{ui.search}
          <input className="input" type="search" placeholder={ui.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 pb-2.5 text-[0.86rem]">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} disabled={!mine.size} />{ui.mineOnly}
        </label>
        {source === "nesa"
          ? <label className="flex items-center gap-2 pb-2.5 text-[0.86rem]"><input type="checkbox" checked={old} onChange={(e) => setOld(e.target.checked)} />{ui.archive}</label>
          : <label className="flex items-center gap-2 pb-2.5 text-[0.86rem]"><input type="checkbox" checked={solOnly} onChange={(e) => setSolOnly(e.target.checked)} />{ui.solOnly}</label>}
        <div role="group" aria-label={ui.areaLabel} className="flex w-full flex-wrap gap-1.5">
          {[null, ...areasPresent].map((a) => (
            <button key={a ?? "all"} type="button" aria-pressed={area === a} onClick={() => setArea(a)}
              className={`rounded-full border px-3 py-1 text-[0.78rem] transition-colors ${area === a ? "border-foreground/40 bg-foreground/10 font-semibold text-foreground" : "border-input-border text-foreground-2 hover:text-foreground"}`}>
              {a ? ui.areas[a] : ui.all}
            </button>
          ))}
        </div>
      </Glass>
      {source === "nesa" && old && <p className="mb-3 max-w-[80ch] text-[0.8rem] text-foreground-3">{ui.oldNote}</p>}
      {source === "thsc" && !thsc ? <p className="text-[0.86rem] text-foreground-3" role="status">{ui.loading}</p> : (
        <>
          <p className="mb-3 text-[0.8rem] text-foreground-3" role="status" aria-live="polite">
            {list.length ? t(list.length === 1 ? ui.count1 : ui.count, { n: list.length }) : t(ui.none, { q })}
          </p>
          {source === "nesa"
            ? sections(nesa).map((s) => (
              <div key={s.key} className="paper-area"><h3 className="paper-area-h">{s.title}</h3><ul className="grid gap-3">{s.items.map((c) => <li key={c.name}>{nesaCard(c)}</li>)}</ul></div>
            ))
            : sections(thscCourses).map((s) => (
              <div key={s.key} className="paper-area"><h3 className="paper-area-h">{s.title}</h3>
                <ul className="grid gap-3">{s.items.map((c) => <li key={c.name}><ThscCard c={c} origin={thsc!.origin} open={open} setOpen={setOpen} solOnly={solOnly} mine={isMine(c.courseIds)} /></li>)}</ul>
              </div>
            ))}
        </>
      )}
      {source === "nesa"
        ? <><p className="mt-4 text-[0.78rem] text-foreground-3">{ui.doneNote}</p><p className="mt-1 text-[0.74rem] text-foreground-3">{t(ui.source, { date: data.generated })}</p></>
        : thsc && <p className="mt-4 text-[0.74rem] text-foreground-3">{t(ui.thscSource, { date: thsc.generated })}</p>}
    </Section>
  );
}
