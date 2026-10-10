// Past papers, from two sources kept apart:
//  • NESA — every official HSC exam, linked straight to the PDF on nsw.gov.au
//    (content/papers.json, scripts/build-papers.mjs, checked weekly).
//  • THSC Online — schools' own trial papers and assessment tasks, linked to THSC's viewer
//    (content/thsc.json, scripts/build-thsc.mjs). Not NESA papers; loaded only when opened.
// Both are grouped by NESA's learning areas, with the student's own subjects first.
// Lazy — check-budget fails the build if any of this reaches the critical path.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import data from "../../content/papers.json";
import ui from "../../content/papers-ui.json";
import site from "../../content/site.json";
import { flushSync } from "react-dom";
import { withTransition } from "../lib/motion.ts";
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
interface Course { name: string; area: Area; courseIds: string[]; successor?: string; years: (Year & { old: boolean; oldName?: string })[] }
interface ThscItem { school: string; year: number | null; sol: boolean; note: string; group: string; f: number; t: string }
interface ThscGroup { yr: 12 | 11; name: string; courseIds: string[]; kind: "trial" | "yearly" | "task"; section: string; page: string; items: ThscItem[] }
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

// One NESA card per course, newest year first. Old-syllabus packs merge into the current course
// they became — same name ("Chemistry"), or the same calculator course ids (Mathematics →
// Mathematics Advanced, Mathematics General → Mathematics Standard) — and their years say so.
const COURSES: Course[] = (() => {
  const by = new Map<string, Course>();
  const packs = data.courses as unknown as Pack[];
  const sameIds = (a: string[], b: string[]) => a.length > 0 && a.length === b.length && a.every((x) => b.includes(x));
  for (const p of [...packs.filter((x) => !x.archive), ...packs.filter((x) => x.archive)]) {
    // NESA's titles vary in case between current and archive packs ("Dutch continuers").
    let key = p.name.toLowerCase();
    if (p.archive && !by.has(key)) key = [...by.entries()].find(([, c]) => sameIds(c.courseIds, p.courseIds))?.[0] ?? key;
    const c = by.get(key) ?? { name: p.name, area: (p.area in ui.areas ? p.area : "Other") as Area, courseIds: [], years: [] };
    c.courseIds = [...new Set([...c.courseIds, ...p.courseIds])];
    c.successor ??= p.successor;
    c.years.push(...p.years.map(([year, fs]) => ({
      year, page: `${p.page}/${year}`, old: p.archive, oldName: p.archive && p.name.toLowerCase() !== c.name.toLowerCase() ? p.name : undefined,
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
        <p className="flex items-center gap-2 text-[0.92rem] font-semibold num">{y.year}{y.old && <span className="pill">{y.oldName ? `${ui.oldSyllabus} · ${y.oldName}` : ui.oldSyllabus}</span>}</p>
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

/**
 * Segmented switch with a thumb that slides to the chosen option (measured, so it follows any
 * label width). The chosen option glows; the others are dimmed. Reduced motion: no slide.
 */
function Switch<K extends string>({ label, value, options, onChange, big }: { label: string; value: K; options: { key: K; label: ReactNode }[]; onChange: (k: K) => void; big?: boolean }) {
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = refs.current[value];
    if (!el) return;
    const measure = () => setBox({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el.parentElement!);
    return () => ro.disconnect();
  }, [value]);
  return (
    <div className={`seg seg-slide ${big ? "seg-lg" : ""}`} role="group" aria-label={label}>
      {box && <span aria-hidden="true" className="seg-thumb" style={{ width: box.w, transform: `translateX(${box.x}px)` }} />}
      {options.map((o) => (
        <button key={o.key} ref={(el) => { refs.current[o.key] = el; }} type="button" className="btn" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

function ThscCard({ c, origin, open, setOpen, solOnly, mine }: { c: ThscCourse; origin: string; open: Set<string>; setOpen: (s: Set<string>) => void; solOnly: boolean; mine: boolean }) {
  // Year 12 has trial papers, Year 11 yearly exams; both sit beside the assessment tasks.
  const trials = c.groups.filter((g) => g.kind !== "task"), tasks = c.groups.filter((g) => g.kind === "task");
  const exam = trials[0]?.kind === "yearly" ? { label: ui.yearly, word: ui.yearlyWord } : { label: ui.trials, word: ui.trialWord };
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
            <div className="mb-1"><Switch label={ui.kindLabel} value={kind} onChange={setKind} options={[
              { key: "trial", label: <>{exam.label} <span className="num seg-count">{count(trials)}</span></> },
              { key: "task", label: <>{ui.tasks} <span className="num seg-count">{count(tasks)}</span></> },
            ]} /></div>
          )}
          <ThscList origin={origin} groups={kind === "trial" ? trials : tasks} solOnly={solOnly} kindWord={kind === "trial" ? exam.word : ui.taskWord} />
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
  // Old-syllabus NESA packs (2014–2018 archive) are part of "every NESA paper", so they show by default.
  const [old, setOld] = useState(true);
  const [yr, setYr] = useState<12 | 11>(12);
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
  const match = useCallback((name: string, ids: string[]) =>
    (!mineOnly || isMine(ids)) && words.every((w) => name.toLowerCase().includes(w)), [mineOnly, isMine, words]);

  const nesa = useMemo(() => COURSES
    .map((c) => ({ ...c, years: old ? c.years : c.years.filter((y) => !y.old) }))
    .filter((c) => c.years.length && match(`${c.name} ${c.successor ?? ""}`, c.courseIds)), [old, match]);
  const thscCourses = useMemo(() => {
    if (!thsc) return [];
    const by = new Map<string, ThscCourse>();
    for (const g of thsc.groups.filter((x) => x.yr === yr).map(expand)) {
      const c = by.get(g.name) ?? { name: g.name, area: areaFor(g.name, g.courseIds), courseIds: g.courseIds, page: g.page, groups: [] };
      c.groups.push(g);
      by.set(g.name, c);
    }
    return [...by.values()].filter((c) => match(c.name, c.courseIds) && (!solOnly || c.groups.some((g) => g.items.some((i) => i.sol))))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [thsc, match, solOnly, yr]);

  // Grouped like NESA and THSC group them — every learning area complete (all the maths courses
  // under Mathematics). Your subjects lead within their area, and areas holding them come first.
  const sections = <T extends { area: Area; courseIds: string[] }>(list: T[]) =>
    AREA_ORDER.map((a) => {
      const items = list.filter((c) => c.area === a).sort((x, y) => Number(isMine(y.courseIds)) - Number(isMine(x.courseIds)));
      return { key: a, title: ui.areas[a], items, mine: items.some((c) => isMine(c.courseIds)) };
    }).filter((s) => s.items.length).sort((x, y) => Number(y.mine) - Number(x.mine));
  const list: { area: Area; courseIds: string[] }[] = source === "nesa" ? nesa : thscCourses;
  // Learning areas are tiles (Mathematics holds Standard, Advanced, Ext 1, Ext 2); tapping one
  // drills in, Back returns to the tile it came from. A search skips the tiles and lists matches.
  const searching = words.length > 0;
  const tiles = sections(list);
  const shownArea = area && tiles.some((s) => s.key === area) ? area : null;
  // View Transitions apply the DOM change a frame or two later; wait for the target before focusing.
  const focusWhen = (sel: string, then?: (el: HTMLElement) => void, tries = 60) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) { el.focus({ preventScroll: true }); then?.(el); }
    else if (tries > 0) requestAnimationFrame(() => focusWhen(sel, then, tries - 1));
  };
  // Every way into a list starts with all courses closed.
  const enter = (a: Area) => {
    withTransition("tab", () => flushSync(() => { setOpen(new Set()); setArea(a); }));
    focusWhen("#papers-area-h", (h) => h.scrollIntoView({ block: "nearest" }));
  };
  const back = () => {
    const from = shownArea;
    withTransition("tab", () => flushSync(() => { setOpen(new Set()); setArea(null); }));
    focusWhen(`#papers .paper-tile[data-area="${from}"]`);
  };
  const courseList = (key: string, items: { area: Area; courseIds: string[] }[]) => source === "nesa"
    ? <ul key={key} className="grid gap-3">{(items as Course[]).map((c) => <li key={c.name}>{nesaCard(c)}</li>)}</ul>
    : <ul key={key} className="grid gap-3">{(items as ThscCourse[]).map((c) => <li key={c.name}><ThscCard c={c} origin={thsc!.origin} open={open} setOpen={setOpen} solOnly={solOnly} mine={isMine(c.courseIds)} /></li>)}</ul>;
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Switch big label={ui.sourceLabel} value={source} onChange={(s) => { setSource(s); setArea(null); setOpen(new Set()); }}
          options={(["nesa", "thsc"] as const).map((k) => ({ key: k, label: ui.sources[k] }))} />
        <Switch big label={ui.yearLabel} value={String(yr) as "12" | "11"} onChange={(y) => { setYr(Number(y) as 12 | 11); setArea(null); setOpen(new Set()); }}
          options={(["12", "11"] as const).map((k) => ({ key: k, label: ui.years2[k] }))} />
      </div>
      {source === "thsc" && (
        <div className="thsc-note mb-4 max-w-[80ch] border-l-2 border-warn/70 pl-3">
          <p className="text-[0.84rem] text-foreground-2">{ui.thscNote}</p>
          <p className="mt-0.5 text-[0.74rem] text-foreground-3">{ui.thscFragile}</p>
        </div>
      )}
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
      </Glass>
      {source === "nesa" && old && <p className="mb-3 max-w-[80ch] text-[0.8rem] text-foreground-3">{ui.oldNote}</p>}
      {source === "nesa" && yr === 11 ? (
        <Glass className="glass-sm p-5 text-center">
          <p className="text-[0.95rem]">{ui.nesaYear11}</p>
          <button type="button" className="btn btn-primary mt-3" onClick={() => { setSource("thsc"); setArea(null); setOpen(new Set()); }}>{ui.nesaYear11Go}</button>
        </Glass>
      ) : source === "thsc" && !thsc ? <p className="text-[0.86rem] text-foreground-3" role="status">{ui.loading}</p> : (
        <>
          <p className="mb-3 text-[0.8rem] text-foreground-3" role="status" aria-live="polite">
            {list.length ? t(list.length === 1 ? ui.count1 : ui.count, { n: list.length }) : t(ui.none, { q })}
          </p>
          {searching ? tiles.map((s) => (
            <div key={s.key} className="paper-area"><h3 className="paper-area-h">{s.title}</h3>{courseList(s.key, s.items)}</div>
          )) : shownArea ? (
            <div className="paper-area">
              <button type="button" className="paper-back" onClick={back}>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>{ui.back}
              </button>
              <h3 id="papers-area-h" tabIndex={-1} className="mt-2 mb-4 text-[1.6rem] font-semibold tracking-[-0.02em] outline-none">{ui.areas[shownArea]}</h3>
              {courseList(shownArea, tiles.find((s) => s.key === shownArea)!.items)}
            </div>
          ) : (
            <ul className="paper-tiles" aria-label={ui.tilesLabel}>
              {tiles.map((s) => {
                const yours = s.items.filter((c) => isMine(c.courseIds)).length;
                return (
                  <li key={s.key}>
                    <button type="button" data-area={s.key} className="glass glass-sm lift paper-tile" onClick={() => enter(s.key)} aria-label={`${t(ui.open, { area: s.title })}, ${t(s.items.length === 1 ? ui.areaCourses1 : ui.areaCourses, { n: s.items.length })}${yours ? `, ${t(ui.areaMine, { n: yours })}` : ""}`}>
                      <span className="min-w-0 flex-1 text-left">
                        <b className="block text-[1.05rem] font-semibold tracking-[-0.01em]">{s.title}</b>
                        <span className="mt-0.5 block text-[0.78rem] text-foreground-3">{t(s.items.length === 1 ? ui.areaCourses1 : ui.areaCourses, { n: s.items.length })}</span>
                        {yours > 0 && <span className="pill mt-2 inline-block !border-accent/50 !text-accent">{t(ui.areaMine, { n: yours })}</span>}
                      </span>
                      <svg aria-hidden="true" className="shrink-0 text-foreground-3" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {source === "nesa"
        ? <><p className="mt-4 text-[0.78rem] text-foreground-3">{ui.doneNote}</p><p className="mt-1 text-[0.74rem] text-foreground-3">{t(ui.source, { date: data.generated })}</p></>
        : thsc && <p className="mt-4 text-[0.74rem] text-foreground-3">{t(ui.thscSource, { date: thsc.generated })}</p>}
    </Section>
  );
}
