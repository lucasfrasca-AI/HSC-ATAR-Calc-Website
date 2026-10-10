// Every course linked to its official NESA syllabus. Loaded on demand —
// check-budget fails the build if this lands on the critical path.
import { useMemo, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { withTransition } from "../lib/motion.ts";
import syl from "../../content/syllabuses.json";
import ui from "../../content/syllabuses-ui.json";
import site from "../../content/site.json";
import { CATALOG } from "../lib/catalog.ts";
import { useCalc } from "../lib/state.tsx";
import { t } from "../lib/text.ts";
import { Glass, Section } from "./ui.tsx";

interface Link { title: string; year: number | null; url: string; kind?: string }
const LINKS = syl.syllabuses as Record<string, Link[]>;
const COURSES = CATALOG.filter((c) => LINKS[c.id]);
// Same learning areas, labels and order as the Papers tab (catalogue area → display label).
const AREAS = (Object.keys(ui.areas) as (keyof typeof ui.areas)[]).filter((a) => COURSES.some((c) => c.area === a));
const label = (a: string) => (ui.areas as Record<string, string>)[a] ?? a;

const External = () => (
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
    <path d="M7 17 17 7" /><path d="M8 7h9v9" />
  </svg>
);

export default function Syllabuses() {
  const { data } = useCalc();
  const [q, setQ] = useState("");
  const [area, setArea] = useState<string | null>(null);   // null = the learning-area tiles
  const [mineOnly, setMineOnly] = useState(false);
  const mine = useMemo(() => new Set(data.subjects.map((s) => s.courseId)), [data.subjects]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return COURSES.filter((c) => (!mineOnly || mine.has(c.id))
      && words.every((w) => `${c.name} ${c.area} ${c.nesaCode ?? ""}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)));
  }, [q, mineOnly, mine]);
  const searching = q.trim().length > 0;
  const tiles = AREAS.map((a) => ({ a, items: shown.filter((c) => c.area === a) })).filter((x) => x.items.length)
    .sort((x, y) => Number(y.items.some((c) => mine.has(c.id))) - Number(x.items.some((c) => mine.has(c.id))));
  const inArea = area && tiles.some((x) => x.a === area) ? area : null;
  // View Transitions apply the DOM change a frame or two later; wait for the target before focusing.
  const focusWhen = (sel: string, tries = 60) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) el.focus({ preventScroll: true }); else if (tries > 0) requestAnimationFrame(() => focusWhen(sel, tries - 1));
  };
  const enter = (a: string) => { withTransition("tab", () => flushSync(() => setArea(a))); focusWhen("#syl-area-h"); };
  const back = () => { const from = inArea; withTransition("tab", () => flushSync(() => setArea(null))); focusWhen(`#syllabuses .paper-tile[data-area="${from}"]`); };
  const visible = searching ? shown : inArea ? shown.filter((c) => c.area === inArea) : [];

  return (
    <Section id="syllabuses" kicker={site.kickers.syllabuses} title={ui.title} intro={ui.intro}>
      <Glass className="glass-sm mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="field min-w-[240px] flex-[2_1_280px]">{ui.search}
          <input className="input" type="search" placeholder={ui.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 pb-2.5 text-[0.86rem]">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} disabled={!mine.size} />{ui.mineOnly}
        </label>
      </Glass>
      <p className="mb-3 text-[0.8rem] text-foreground-3" role="status" aria-live="polite">
        {shown.length ? t(shown.length === 1 ? ui.count1 : ui.count, { n: shown.length }) : t(ui.none, { q })}
      </p>
      {!searching && !inArea && (
        <ul className="paper-tiles mb-2" aria-label={ui.tilesLabel}>
          {tiles.map(({ a, items }) => {
            const yours = items.filter((c) => mine.has(c.id)).length;
            const n = t(items.length === 1 ? ui.areaCourses1 : ui.areaCourses, { n: items.length });
            return (
              <li key={a}>
                <button type="button" data-area={a} className="glass glass-sm lift paper-tile" onClick={() => enter(a)}
                  aria-label={`${t(ui.open, { area: label(a) })}, ${n}${yours ? `, ${t(ui.areaMine, { n: yours })}` : ""}`}>
                  <span className="min-w-0 flex-1 text-left">
                    <b className="block text-[1.05rem] font-semibold tracking-[-0.01em]">{label(a)}</b>
                    <span className="mt-0.5 block text-[0.78rem] text-foreground-3">{n}</span>
                    {yours > 0 && <span className="pill mt-2 inline-block !border-accent/50 !text-accent">{t(ui.areaMine, { n: yours })}</span>}
                  </span>
                  <svg aria-hidden="true" className="shrink-0 text-foreground-3" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!searching && inArea && (
        <>
          <button type="button" className="paper-back" onClick={back}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>{ui.back}
          </button>
          <h3 id="syl-area-h" tabIndex={-1} className="mt-2 mb-4 text-[1.6rem] font-semibold tracking-[-0.02em] outline-none">{label(inArea)}</h3>
        </>
      )}
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
        {visible.map((c, i) => (
          <li key={c.id} className="rise" style={{ "--i": Math.min(i, 12) } as CSSProperties}>
            <Glass className="lift glass-sm flex h-full flex-col gap-3 p-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[0.98rem] leading-snug font-semibold">{c.name}</h3>
                  {mine.has(c.id) && <span className="pill shrink-0 !border-accent/50 !text-accent">{ui.mine}</span>}
                </div>
                <p className="mt-0.5 text-[0.74rem] text-foreground-3">
                  {c.area} · {c.units === 1 ? site.labels.units1 : site.labels.units2}{c.nesaCode ? ` · ${t(ui.nesa, { code: c.nesaCode })}` : ""}
                </p>
              </div>
              <ul className="mt-auto space-y-1.5">
                {LINKS[c.id]!.map((l, k) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="group glass-inset flex items-center justify-between gap-2 px-3 py-2 text-[0.82rem] text-foreground no-underline transition-colors hover:bg-foreground/[0.06]">
                      <span className="min-w-0">
                        <span className="block truncate">{l.title}</span>
                        {LINKS[c.id]!.length > 1 && k === 0 && <span className="text-[0.7rem] text-foreground-3">{ui.newest}</span>}
                        {l.kind === "framework" && <span className="text-[0.7rem] text-foreground-3">{ui.framework}</span>}
                      </span>
                      <External /><span className="sr-only">{ui.opensNew}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Glass>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[0.78rem] text-foreground-3">{ui.phaseNote}</p>
      <p className="mt-1 text-[0.74rem] text-foreground-3">{ui.source}</p>
    </Section>
  );
}
