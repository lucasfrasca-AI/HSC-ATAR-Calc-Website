import { useState, type CSSProperties } from "react";
import site from "../../content/site.json";
import sub from "../../content/subjects.json";
import { CATALOG, COHORT_LEVELS, TIERS, courseById, isLevel, isTier, type Course, type TierKey } from "../lib/catalog.ts";
import { CourseSearch } from "./CourseSearch.tsx";
import {
  bandOf, blankData, blankTask, displayName, fmt, inRange, internalInfo, subjectFrom, taskMark, usedInternal,
  type Data, type Subject, type Task,
} from "../lib/engine.ts";
import { sampleData, useCalc } from "../lib/state.tsx";
import { msg, t } from "../lib/text.ts";
import { useFeedback } from "./Feedback.tsx";
import { Glass, NumInput, Section, TextInput } from "./ui.tsx";

const AREAS = [...new Set(CATALOG.map((c) => c.area))];
function CourseOptions() {
  return <>{AREAS.map((a) => (
    <optgroup key={a} label={a}>
      {CATALOG.filter((c) => c.area === a).map((c) => <option key={c.id} value={c.id}>{c.name}{c.units === 1 ? ` (${site.labels.units1})` : ""}</option>)}
    </optgroup>
  ))}</>;
}

const scalingText = (s: Subject) => {
  const c = courseById(s.courseId);
  if (s.scaling === "course") return sub.settings.labelSupplied;
  if (s.scaling === "custom") return sub.settings.labelCustom;
  if (s.scaling === c.tier && c.tierSource === "default") return sub.settings.labelDefault;
  return t(sub.settings.labelTier, { label: TIERS[s.scaling].label.toLowerCase() });
};

type Panel = "tasks" | "exam" | "settings";
function SubjectCard({ s, i }: { s: Subject; i: number }) {
  const { data, v, update, undo } = useCalc();
  const { toast } = useFeedback();
  const [open, setOpen] = useState<Set<Panel>>(new Set());
  const toggle = (p: Panel, on?: boolean) => setOpen((o) => { const n = new Set(o); if (on ?? !n.has(p)) n.add(p); else n.delete(p); return n; });
  const edit = (fn: (x: Subject) => void) => update((d) => fn(d.subjects.find((x) => x.uid === s.uid)!));
  const editTask = (ti: number, fn: (t: Task) => void) => edit((x) => fn(x.tasks[ti]!));

  const info = internalInfo(s), used = usedInternal(data.settings, s, info);
  const name = displayName(s) || sub.card.customName;
  const nameForLabels = displayName(s) || site.labels.thisCourse;
  const msgs = v.issues.filter((x) => x.uid === s.uid);
  const hasErr = msgs.some((m) => m.level === "error");
  const tasksMode = s.mode === "tasks";
  const c = courseById(s.courseId);
  const e = inRange(s.expected, 0, 100), tg = inRange(s.target, 0, 100);
  const pid = (p: Panel) => `${p}-${s.uid}`;

  const changeCourse = (id: string) => update((d) => {
    const k = d.subjects.findIndex((x) => x.uid === s.uid), old = d.subjects[k]!;
    const fresh = subjectFrom(id, { internalMark: old.internalMark, rank: old.rank, cohortSize: old.cohortSize, mode: old.mode, tasks: old.tasks, exam: old.exam, cohortMean: old.cohortMean, expected: old.expected, target: old.target, focus: old.focus });
    fresh.uid = old.uid;
    d.subjects[k] = fresh;
  });
  const remove = () => {
    update((d) => { d.subjects = d.subjects.filter((x) => x.uid !== s.uid); });
    toast(t(site.toasts.removed, { name: nameForLabels }), { label: site.toasts.undo, run: undo });
  };
  const openTasks = () => {
    if (!tasksMode) {
      edit((x) => { x.mode = "tasks"; if (!x.tasks.length) x.tasks = [blankTask(), blankTask(), blankTask()]; });
      toggle("tasks", true);
      requestAnimationFrame(() => document.getElementById(`tw-${s.uid}-0`)?.focus());
    } else toggle("tasks");
  };
  const stopTasks = () => {
    edit((x) => { const inf = internalInfo(x); if (inf.fromTasks) x.internalMark = Math.round(inf.mark! * 10) / 10; x.mode = "simple"; });
    toggle("tasks", false);
    toast(site.toasts.tasksStopped);
  };

  return (
    <Glass as="article" id={`card-${s.uid}`} aria-labelledby={`cn-${s.uid}`} className={`rise glass-sm mb-3.5 scroll-mt-24 overflow-hidden border-l-4 ${hasErr ? "!border-loss" : ""}`} style={{ ...(hasErr ? {} : { borderLeftColor: `hsl(var(--subject-${(i % 8) + 1}))` }), "--i": i } as CSSProperties}>
      <h3 id={`cn-${s.uid}`} className="sr-only">{name}</h3>
      <div className="grid items-start gap-3 p-4 pb-2 md:grid-cols-[minmax(200px,2fr)_minmax(140px,1fr)_minmax(200px,1.2fr)_auto] grid-cols-[1fr_1fr_auto]">
        <label className="field col-span-2 md:col-span-1">{sub.card.course}
          <select className="input" value={s.courseId} onChange={(ev) => changeCourse(ev.target.value)}><CourseOptions /></select>
        </label>
        <label className="field" htmlFor={`im-${s.uid}`}>
          <span>{sub.card.internal}<span className="req">{sub.card.required}</span></span>
          <NumInput id={`im-${s.uid}`} min={0} max={100} step={0.1} placeholder={sub.card.internalPlaceholder}
            readOnly={info.fromTasks} value={info.fromTasks ? Math.round(info.mark! * 10) / 10 : s.internalMark}
            aria-describedby={`imh-${s.uid}`} onValue={(val) => { if (!info.fromTasks) edit((x) => { x.internalMark = val; }); }} />
          <span className="help" id={`imh-${s.uid}`}>{info.fromTasks ? sub.card.fromTasks : tasksMode ? sub.card.untilTask : ""}</span>
        </label>
        <div className="field col-span-2 md:col-span-1">
          <span>{sub.card.rank} <span className="opt">{sub.card.optional}</span></span>
          <div className="flex items-center gap-1.5">
            <NumInput integer min={1} step={1} placeholder={sub.card.rankPlaceholder} aria-label={t(sub.card.rankLabel, { name: nameForLabels })} value={s.rank} onValue={(val) => edit((x) => { x.rank = val; })} aria-describedby={`rh-${s.uid}`} />
            <span className="text-[0.82rem] text-foreground-3">{sub.card.of}</span>
            <NumInput integer min={1} step={1} placeholder={sub.card.cohortPlaceholder} aria-label={t(sub.card.cohortLabel, { name: nameForLabels })} value={s.cohortSize} onValue={(val) => edit((x) => { x.cohortSize = val; })} />
          </div>
          <span className="help" id={`rh-${s.uid}`}>
            {info.rankFromTasks ? t(sub.card.rankFromTasks, { rank: fmt(info.rank) })
              : used.moderated ? t(sub.card.rankModerated, { mark: fmt(used.mark) })
              : info.rank !== null && info.cohort ? t(sub.card.rankTop, { pct: fmt((info.rank / info.cohort) * 100, 0) })
              : sub.card.rankHelp}
          </span>
        </div>
        <button type="button" className="mt-5 row-start-1 col-start-3 md:col-start-4 grid h-9 w-9 place-items-center rounded-full text-[1.4rem] text-foreground-3 hover:bg-loss/10 hover:text-loss" aria-label={t(sub.card.remove, { name: nameForLabels })} onClick={remove}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {s.courseId === "custom" && (
        <div className="px-4 pb-2">
          <label className="field max-w-sm">
            <span>{sub.card.customName}<span className="req">{sub.card.required}</span></span>
            <TextInput id={`cname-${s.uid}`} className="input" maxLength={60} placeholder={sub.card.customPlaceholder} value={s.name} onText={(v) => edit((x) => { x.name = v; })} />
          </label>
        </div>
      )}
      <p className="px-4 text-[0.78rem] text-foreground-3">
        {t(sub.card.meta, { units: s.units === 1 ? site.labels.units1 : site.labels.units2, area: c.area, english: s.english ? sub.card.metaEnglish : "", scaling: scalingText(s) })}
        {s.scaling !== "course" && s.scaling !== "custom" && <span className="flag">{site.labels.estimate}</span>}
      </p>
      {msgs.length > 0 && (
        <ul className="mt-2 space-y-1.5 px-4">
          {msgs.map((m, k) => (
            <li key={k} className={`rounded-lg px-2.5 py-1.5 text-[0.8rem] ${m.level === "error" ? "bg-loss/12 text-loss" : m.level === "warn" ? "bg-warn/12 text-warn" : "bg-foreground/5 text-foreground-2"}`}>
              <span className="sr-only">{site.checks.levels[m.level]}: </span>{msg(m)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 px-4 pt-2.5 pb-3.5">
        <button type="button" className="btn chip-btn" aria-expanded={tasksMode && open.has("tasks")} aria-controls={pid("tasks")} onClick={openTasks}>
          {tasksMode ? t(sub.card.chipTasks, { n: s.tasks.length }) : s.tasks.length ? sub.card.chipUseTasks : sub.card.chipAddTasks}
        </button>
        <button type="button" className="btn chip-btn" aria-expanded={open.has("exam")} aria-controls={pid("exam")} onClick={() => toggle("exam")}>
          {e !== null || tg !== null ? t(sub.card.chipExamSet, { detail: [e !== null ? t(sub.card.chipExpected, { v: fmt(e) }) : "", tg !== null ? t(sub.card.chipTarget, { v: fmt(tg) }) : ""].filter(Boolean).join(" · ") }) : sub.card.chipExam}
        </button>
        <button type="button" className="btn chip-btn" aria-expanded={open.has("settings")} aria-controls={pid("settings")} onClick={() => toggle("settings")}>{sub.card.chipSettings}</button>
      </div>

      {tasksMode && (
        <div id={pid("tasks")} hidden={!open.has("tasks")} className="reveal border-t border-border/10 bg-foreground/[0.025] px-4 pt-3.5 pb-4">
          <p className="mb-2.5 max-w-[70ch] text-[0.8rem] text-foreground-3">{sub.tasks.note}</p>
          <div className="tscroll">
            <table className="datatable min-w-[640px]">
              <thead><tr>
                <th scope="col">{sub.tasks.cols.task} <span className="opt">{sub.card.optional}</span></th>
                {(["weight", "score", "outOf", "pct", "mark", "rank"] as const).map((k) => <th key={k} scope="col">{sub.tasks.cols[k]}</th>)}
                <th><span className="sr-only">{sub.tasks.aria.remove}</span></th>
              </tr></thead>
              <tbody>
                {s.tasks.map((tk, ti) => {
                  const n = ti + 1, m = taskMark(tk);
                  return (
                    <tr key={ti}>
                      <td><TextInput className="input input-sm !w-full min-w-[150px] !text-left" maxLength={80} placeholder={t(sub.tasks.placeholder, { n })} aria-label={t(sub.tasks.aria.name, { n })} value={tk.name} onText={(v) => editTask(ti, (x) => { x.name = v; })} /></td>
                      <td><NumInput id={`tw-${s.uid}-${ti}`} className="input-sm" min={0} max={100} step={0.5} aria-label={t(sub.tasks.aria.weight, { n })} value={tk.weight} onValue={(val) => editTask(ti, (x) => { x.weight = val; })} /></td>
                      <td><NumInput className="input-sm" min={0} step={0.5} aria-label={t(sub.tasks.aria.score, { n })} value={tk.raw} onValue={(val) => editTask(ti, (x) => { x.raw = val; })} /></td>
                      <td><NumInput className="input-sm" min={1} step={0.5} aria-label={t(sub.tasks.aria.outOf, { n })} value={tk.max} onValue={(val) => editTask(ti, (x) => { x.max = val; })} /></td>
                      <td><NumInput className="input-sm" min={0} max={100} step={0.1} title={sub.tasks.pctTitle} aria-label={t(sub.tasks.aria.pct, { n })} value={tk.pct} onValue={(val) => editTask(ti, (x) => { x.pct = val; })} /></td>
                      <td className="text-foreground-2">{m === null ? site.labels.dash : `${fmt(m)}%`}</td>
                      <td><NumInput integer className="input-sm" min={1} step={1} aria-label={t(sub.tasks.aria.rank, { n })} value={tk.rank} onValue={(val) => editTask(ti, (x) => { x.rank = val; })} /></td>
                      <td><button type="button" className="px-1.5 text-[1.1rem] text-foreground-3 hover:text-loss" aria-label={t(sub.tasks.aria.remove, { n })} onClick={() => edit((x) => { x.tasks.splice(ti, 1); })}><span aria-hidden="true">×</span></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2.5">
            <button type="button" className="btn" onClick={() => edit((x) => { x.tasks.push(blankTask()); })}>{sub.tasks.add}</button>
            <span className="text-[0.82rem] text-foreground-2 num">{t(sub.tasks.weights, { sum: fmt(info.weightSum ?? 0) })}</span>
            <button type="button" className="btn" onClick={stopTasks}>{sub.tasks.stop}</button>
          </div>
        </div>
      )}

      <div id={pid("exam")} hidden={!open.has("exam")} className="reveal border-t border-border/10 bg-foreground/[0.025] px-4 pt-3.5 pb-4">
        <p className="mb-2.5 max-w-[70ch] text-[0.8rem] text-foreground-3">{sub.exam.note}</p>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
          {([["exam", sub.exam.whatIf, sub.exam.whatIfHelp, sub.exam.whatIfPlaceholder], ["expected", sub.exam.expected, sub.exam.expectedHelp, sub.exam.notSaved], ["target", sub.exam.target, sub.exam.targetHelp, sub.exam.notSaved]] as const).map(([k, label, help, ph]) => (
            <label key={k} className="field">{label}
              <NumInput min={0} max={100} step={0.5} placeholder={ph} value={s[k]} onValue={(val) => edit((x) => { x[k] = val; })} />
              <span className="help">{help}</span>
            </label>
          ))}
        </div>
      </div>

      <div id={pid("settings")} hidden={!open.has("settings")} className="reveal border-t border-border/10 bg-foreground/[0.025] px-4 pt-3.5 pb-4">
        <p className="mb-2.5 max-w-[70ch] text-[0.8rem] text-foreground-3">{sub.settings.note}</p>
        <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
          <label className="field">{sub.settings.units}
            <select className="input" value={s.units} onChange={(ev) => edit((x) => { x.units = Number(ev.target.value) === 1 ? 1 : 2; })}>
              <option value={1}>{site.labels.units1}</option><option value={2}>{site.labels.units2}</option>
            </select>
          </label>
          <div className="field">{sub.settings.english}
            <label className="flex items-center gap-2 py-2 text-[0.86rem] text-foreground"><input type="checkbox" checked={s.english} onChange={(ev) => edit((x) => { x.english = ev.target.checked; })} />{sub.settings.englishToggle}</label>
          </div>
          <label className="field"><span>{sub.settings.cohortMean} <span className="opt">{sub.settings.cohortMeanOpt}</span></span>
            <NumInput min={0} max={100} step={0.5} placeholder={sub.settings.cohortMeanPlaceholder} value={s.cohortMean} onValue={(val) => edit((x) => { x.cohortMean = val; })} />
          </label>
        </div>
        <label className="field max-w-[380px]">{sub.settings.scaling}
          <select className="input" value={s.scaling} onChange={(ev) => edit((x) => {
            const val = ev.target.value;
            if (val === "course" && c.anchors) { x.scaling = "course"; x.anchors = structuredClone(c.anchors); }
            else if (isTier(val)) { x.scaling = val; x.anchors = structuredClone(TIERS[val].anchors); }
            else x.scaling = "custom";
          })}>
            {c.anchors && <option value="course">{sub.settings.scalingCourse}</option>}
            {(Object.keys(TIERS) as TierKey[]).map((k) => <option key={k} value={k}>{t(sub.settings.scalingTier, { label: TIERS[k].label })}</option>)}
            <option value="custom">{sub.settings.scalingCustom}</option>
          </select>
        </label>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {s.anchors.map((a, ai) => (
            <span key={ai} className="glass-inset flex items-center gap-1.5 px-2 py-1.5 text-[0.78rem] text-foreground-3">
              <NumInput className="input-sm !w-[62px]" step={0.1} aria-label={t(sub.settings.anchorFrom, { n: ai + 1 })} value={a[0]} onValue={(val) => edit((x) => { x.anchors[ai]![0] = val; x.scaling = "custom"; })} />
              <span aria-hidden="true">→</span>
              <NumInput className="input-sm !w-[62px]" step={0.1} aria-label={t(sub.settings.anchorTo, { n: ai + 1 })} value={a[1]} onValue={(val) => edit((x) => { x.anchors[ai]![1] = val; x.scaling = "custom"; })} />
            </span>
          ))}
        </div>
        <p className="mt-2 text-[0.8rem] text-foreground-3">{sub.settings.anchorNote}</p>
      </div>
    </Glass>
  );
}

function AddBar() {
  const { data, update, replace, undo } = useCalc();
  const { toast } = useFeedback();
  const add = (c: Course) => {
    if (c.id !== "custom" && data.subjects.some((s) => s.courseId === c.id)) { toast(t(site.toasts.already, { name: c.name })); return; }
    const s = subjectFrom(c.id);
    update((d: Data) => { d.subjects.push(s); }, { discrete: true });
    toast(t(sub.add.added, { name: c.name }));
    // Keep focus in the search so a whole subject list can be typed in one go;
    // bring the new card into view without stealing focus.
    requestAnimationFrame(() => {
      document.getElementById(`card-${s.uid}`)?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      if (c.id === "custom") document.getElementById(`cname-${s.uid}`)?.focus({ preventScroll: true });
    });
  };
  const test = () => {
    const had = data.subjects.length > 0;
    replace(sampleData());
    toast(site.toasts.testLoaded, had ? { label: site.toasts.undo, run: undo } : undefined);
  };
  const clear = () => {
    if (!data.subjects.length) return;
    replace(blankData());
    toast(site.toasts.cleared, { label: site.toasts.undo, run: undo });
  };
  return (
    <div className="flex flex-wrap items-start gap-2.5 rounded-[16px] border border-dashed border-input-border p-4">
      <div className="field flex-[1_1_320px]">
        <label htmlFor="addCourse">{sub.add.label}</label>
        <CourseSearch inputId="addCourse" onPick={add} />
      </div>
      <div className="flex flex-wrap gap-2.5 sm:mt-[22px]">
        <button type="button" className="btn" onClick={test}>{sub.add.test}</button>
        <button type="button" className="btn btn-danger" onClick={clear}>{sub.add.clear}</button>
      </div>
    </div>
  );
}

function SummaryTable() {
  const { data } = useCalc();
  if (!data.subjects.length) return null;
  const k = sub.summary;
  const rows = data.subjects.map((s) => { const info = internalInfo(s); return { s, info, used: usedInternal(data.settings, s, info) }; });
  const tu = rows.reduce((a, r) => a + r.s.units, 0);
  const marks = rows.flatMap((r) => (r.info.mark === null ? [] : [r.info.mark]));
  const positions = rows.flatMap((r) => (r.info.rank !== null && r.info.cohort ? [r.info.rank / r.info.cohort] : []));
  const n = marks.length, tm = marks.reduce((a, m) => a + m, 0), rc = positions.length, rs = positions.reduce((a, p) => a + p, 0);
  return (
    <Section id="summary" kicker={site.kickers.summary} title={k.title} intro={k.intro}>
      <Glass className="glass-sm tscroll">
        <table className="datatable min-w-[680px]">
          <thead><tr>{Object.values(k.cols).map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(({ s, info, used }) => (
              <tr key={s.uid}>
                <td>{displayName(s) || site.labels.unnamed} <span className="text-[0.82em] text-foreground-3">{t(k.unitsShort, { n: s.units })}</span></td>
                <td>{info.fromTasks ? t(s.tasks.length === 1 ? k.tasks1 : k.tasks, { n: s.tasks.length }) : k.final}</td>
                <td>{info.fromTasks ? `${fmt(info.weightSum)}%` : site.labels.dash}</td>
                <td><b>{info.mark === null ? site.labels.dash : `${fmt(info.mark)}%`}</b></td>
                <td>{info.rank === null ? site.labels.dash : fmt(info.rank, info.rankFromTasks ? 1 : 0)}{info.cohort ? <span className="text-foreground-3"> / {info.cohort}</span> : null}</td>
                <td>{info.rank !== null && info.cohort ? t(k.top, { pct: fmt((info.rank / info.cohort) * 100, 0) }) : site.labels.dash}</td>
                <td>{used.moderated ? `${fmt(used.mark)}%` : site.labels.dash}</td>
                <td>{info.mark === null ? site.labels.dash : <span className="rounded-md border border-input-border px-2 text-[0.8rem] font-semibold">{t(k.band, { n: bandOf(info.mark) })}</span>}</td>
              </tr>
            ))}
            <tr className="total">
              <td>{k.all} <span className="text-[0.82em] font-normal text-foreground-3">{t(k.units, { n: tu })}</span></td><td /><td />
              <td>{n ? `${fmt(tm / n)}%` : site.labels.dash}</td><td />
              <td>{rc ? t(k.top, { pct: fmt((rs / rc) * 100, 0) }) : site.labels.dash}</td><td />
              <td>{n ? t(k.band, { n: bandOf(tm / n) }) : site.labels.dash}</td>
            </tr>
          </tbody>
        </table>
      </Glass>
    </Section>
  );
}

function OptionalSettings() {
  const { data, update } = useCalc();
  const o = sub.optional;
  const st = data.settings;
  return (
    <Section>
      <Glass as="details" className="glass-sm">
        <summary className="flex justify-between px-5 py-3.5 text-[0.92rem] font-semibold">{o.summary} <span className="plus" aria-hidden="true">+</span></summary>
        <div className="grid gap-4 border-t border-border/10 p-5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          <label className="field"><span>{o.name} <span className="opt">{o.nameOpt}</span></span>
            <TextInput className="input" maxLength={60} placeholder={o.namePlaceholder} value={data.name} onText={(v) => update((d) => { d.name = v; })} />
          </label>
          <div className="field"><span>{o.mod} <span className="opt">{o.nameOpt}</span></span>
            <label className="flex items-center gap-2 py-2 text-[0.86rem] text-foreground"><input type="checkbox" checked={st.moderation} onChange={(e) => update((d) => { d.settings.moderation = e.target.checked; })} />{o.modToggle}</label>
            <span className="help">{o.modHelp}</span>
          </div>
          <label className="field">{o.level}
            <select className="input" disabled={!st.moderation} value={st.level} onChange={(e) => { const val = e.target.value; if (isLevel(val)) update((d) => { d.settings.level = val; }); }}>
              {Object.entries(COHORT_LEVELS).map(([k, l]) => <option key={k} value={k}>{t(o.levelOption, { label: l.label, mean: l.mean })}</option>)}
            </select>
            <span className="help">{o.levelHelp}</span>
          </label>
          <label className="field"><span>{o.spread} <span className="opt">{o.spreadOpt}</span></span>
            <NumInput min={3} max={25} step={0.5} disabled={!st.moderation} value={st.spread} onValue={(val) => { const x = inRange(val, 3, 25); if (x !== null) update((d) => { d.settings.spread = x; }); }} />
            <span className="help">{o.spreadHelp}</span>
          </label>
        </div>
      </Glass>
    </Section>
  );
}

export function Subjects() {
  const { data } = useCalc();
  return (
    <>
      <Section id="your-subjects" kicker={site.kickers.subjects} title={sub.title} intro={<>{sub.intro.split(sub.introStrong)[0]}<b className="text-foreground">{sub.introStrong}</b>{sub.intro.split(sub.introStrong)[1]}</>}>
        {!data.subjects.length && (
          <Glass className="glass-sm mb-3.5 px-5 py-10 text-center">
            <h3 className="text-[1.3rem] font-semibold">{sub.noneTitle}</h3>
            <p className="mx-auto mt-2 max-w-[52ch] text-foreground-2">{sub.noneBody}</p>
          </Glass>
        )}
        {data.subjects.map((s, i) => <SubjectCard key={s.uid} s={s} i={i} />)}
        <AddBar />
      </Section>
      <SummaryTable />
      <OptionalSettings />
    </>
  );
}
