import calc from "../../content/calculator.json";
import site from "../../content/site.json";
import {
  aggregateToAtar, atarToAgg, displayName, examImpact, nextBand, planFor, BAND_FLOORS, examOf, fmt, inRange, isEstimate, scenarioAgg, COUNTING_UNITS, MAX_AGGREGATE,
  type Subject,
} from "../lib/engine.ts";
import { useNav } from "../lib/nav.ts";
import { sampleData, useCalc, type GoalField } from "../lib/state.tsx";
import { cap, msg, signed, t } from "../lib/text.ts";
import { CurveChart } from "./CurveChart.tsx";
import { useFeedback } from "./Feedback.tsx";
import { useDeferredValue, useMemo, useState, type CSSProperties } from "react";
import { Glass, NumInput, Range, Section, Stat, TweenNum } from "./ui.tsx";

const subjectColour = (i: number) => `hsl(var(--subject-${(i % 8) + 1}))`;
const unitsLabel = (n: number) => (n === 1 ? site.labels.units1 : site.labels.units2);

/* ---------------- steps + checks + empty ---------------- */
function Steps() {
  const { data, v } = useCalc();
  const nav = useNav();
  const n = data.subjects.length;
  const s1 = v.eligible, s2 = data.subjects.some((s) => s.exam !== null);
  const hasE = data.subjects.some((s) => inRange(s.expected, 0, 100) !== null);
  const hasT = data.subjects.some((s) => inRange(s.target, 0, 100) !== null);
  const s3 = hasE && hasT;
  const next = !s1 ? 1 : !s2 ? 2 : !s3 ? 3 : 0;
  const reason = v.eligReasons[0] ? msg(v.eligReasons[0]) : site.steps.s1.fallback;
  const steps = [
    { k: 1, done: s1, title: site.steps.s1.title, go: () => nav.go("subj"),
      d: !n ? site.steps.s1.empty : s1 ? t(n === 1 ? site.steps.s1.ok1 : site.steps.s1.ok, { n }) : t(n === 1 ? site.steps.s1.bad1 : site.steps.s1.bad, { n, reason }) },
    { k: 2, done: s2, title: site.steps.s2.title, d: site.steps.s2.detail, go: () => nav.scrollTo("curve") },
    { k: 3, done: s3, title: site.steps.s3.title, go: () => nav.scrollTo("curve"),
      d: hasE || hasT ? t(site.steps.s3.some, { e: hasE ? site.steps.s3.saved : site.steps.s3.notSaved, t: hasT ? site.steps.s3.saved : site.steps.s3.notSaved }) : site.steps.s3.none },
  ];
  return (
    <ol className="mb-5 grid gap-2.5 md:grid-cols-3" aria-label={site.steps.label}>
      {steps.map((s) => (
        <li key={s.k}>
          <button
            type="button" onClick={s.go} aria-current={next === s.k ? "step" : undefined}
            style={{ "--i": s.k } as CSSProperties}
            className={`rise lift glass glass-sm flex h-full w-full items-start gap-3 p-3.5 text-left ${next === s.k ? "!border-accent/60" : ""}`}
          >
            <span aria-hidden="true" className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-[0.85rem] font-bold ${s.done ? "border-gain bg-gain text-on-fill" : next === s.k ? "border-accent text-accent" : "border-input-border text-foreground-2"}`}>
              {s.done ? "✓" : s.k}
            </span>
            <span>
              <b className="block text-[0.9rem]">{s.title}<span className="sr-only"> — {s.done ? site.steps.doneLabel : next === s.k ? site.steps.nextLabel : ""}</span></b>
              <span className="block text-[0.78rem] text-foreground-3">{s.d}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

const DOT = { error: "×", warn: "!", info: "i", ok: "✓" } as const;
const DOT_BG = { error: "bg-loss", warn: "bg-warn", info: "bg-foreground-3", ok: "bg-gain" } as const;
function Dot({ level }: { level: keyof typeof DOT }) {
  return <span aria-hidden="true" className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[0.7rem] font-bold text-on-fill ${DOT_BG[level]}`}>{DOT[level]}</span>;
}
function Checks() {
  const { data, v } = useCalc();
  const nav = useNav();
  if (!data.subjects.length) return null;
  const errs = v.issues.filter((i) => i.level === "error"), warns = v.issues.filter((i) => i.level === "warn");
  const list = [...errs, ...warns];
  const tone = errs.length ? "border-l-loss" : warns.length ? "border-l-warn" : "border-l-gain";
  return (
    <Glass className={`glass-sm mb-6 border-l-4 px-4 py-3.5 ${tone}`} role="region" aria-label={site.checks.regionLabel}>
      {!list.length ? (
        <p className="flex gap-2.5 text-[0.88rem]"><Dot level="ok" />{site.checks.ok}</p>
      ) : (
        <ul className="space-y-1.5 text-[0.88rem]">
          {errs.length > 0 && <li className="flex gap-2.5 font-semibold"><Dot level="error" />{v.eligReasons.length ? site.checks.notEligible : site.checks.needsFix}</li>}
          {list.slice(0, 6).map((i, k) => (
            <li key={k} className="flex gap-2.5">
              <Dot level={i.level} />
              <span><span className="sr-only">{site.checks.levels[i.level]}: </span>{msg(i)}
                {i.uid && <> <button type="button" className="text-accent underline underline-offset-2" onClick={() => nav.jumpToSubject(i.uid!)}>{site.checks.fix}</button></>}
              </span>
            </li>
          ))}
          {list.length > 6 && <li className="flex gap-2.5"><Dot level="info" />{t(site.checks.more, { n: list.length - 6 })}</li>}
        </ul>
      )}
    </Glass>
  );
}

export function EmptyState({ onTest }: { onTest: () => void }) {
  const nav = useNav();
  return (
    <Glass className="px-5 py-12 text-center">
      <h2 className="text-[clamp(1.45rem,3vw,2rem)] font-semibold tracking-[-0.025em]">{site.empty.title}</h2>
      <p className="mx-auto mt-3 mb-6 max-w-[52ch] text-foreground-2">{site.empty.body}</p>
      <div className="flex flex-wrap justify-center gap-2.5">
        <button type="button" className="btn btn-primary" onClick={() => nav.go("subj", "addCourse")}>{site.empty.add}</button>
        <button type="button" className="btn" onClick={onTest}>{site.empty.test}</button>
      </div>
      <p className="mx-auto mt-5 max-w-[52ch] text-[0.8rem] text-foreground-3">{site.empty.note}</p>
    </Glass>
  );
}

/* ---------------- curve + goal panel ---------------- */
function GoalNote() {
  const { goal } = useCalc();
  if (!goal) return <>{calc.curve.goalDefault}</>;
  const label = site.labels[goal.field], Label = cap(label), r = goal.shift;
  if (r.capped === "max") return <>{t(calc.curve.goalMax, { Label, atar: fmt(aggregateToAtar(r.hi), 2), want: fmt(goal.atar, 2) })}</>;
  if (r.capped === "min") return <>{t(calc.curve.goalMin, { Label, atar: fmt(aggregateToAtar(r.lo), 2) })}</>;
  return <>{t(calc.curve.goalOk, {
    Label, want: fmt(goal.atar, 2), delta: signed(r.delta),
    each: r.n > 1 ? (r.clipped ? calc.curve.onAverage : calc.curve.each) : "",
    from: goal.hadSet ? t(calc.curve.goalFromPrev, { label }) : calc.curve.goalFromWhatIf,
  })}</>;
}

function AtarBox({ id, label, value, onSet, big, placeholder }: { id: string; label: string; value: number | null; onSet: (v: number | null) => void; big?: boolean; placeholder?: string }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <NumInput
        id={id} value={value === null ? null : Math.round(value * 100) / 100} min={0} max={99.95} step={0.05} placeholder={placeholder}
        className={big ? "!max-w-[240px] !border-b-[3px] !border-b-accent-fill !py-1 !text-[2.6rem] font-semibold tracking-[-0.03em]" : "!text-[1.05rem] font-semibold"}
        onCommit={onSet}
      />
    </label>
  );
}

function CurveSection() {
  const calcState = useCalc();
  const { data, c, update, setAggregate, lastDrag, clearDrag, goalSet, clearGoal, undo } = calcState;
  const { toast } = useFeedback();
  const E = scenarioAgg(data, "expected"), T = scenarioAgg(data, "target");
  const has = c.counted.length > 0;
  const rows = c.rows.filter((r) => r.valid);
  const nFocus = rows.filter((r) => r.s.focus).length;

  const setGoal = async (field: GoalField, v: number | null) => {
    if (v === null) {
      if (data.subjects.some((s) => inRange(s[field], 0, 100) !== null)) {
        update((d) => { for (const s of d.subjects) s[field] = null; }); clearGoal();
        toast(t(site.toasts.clearedSet, { label: site.labels[field] }), { label: site.toasts.undo, run: undo });
      }
      return;
    }
    const v2 = inRange(v, 0, 99.95);
    if (v2 === null) return;
    const err = goalSet(field, v2);
    if (err) toast(site.toasts[err]);
  };

  const who = (n: number, upper: boolean) => (n === 1 ? (upper ? calc.curve.WhoOne : calc.curve.whoOne) : t(upper ? calc.curve.WhoMany : calc.curve.whoMany, { n }));
  let note = "";
  if (rows.length) {
    if (!nFocus) note = calc.curve.noteNoFocus;
    else if (lastDrag) {
      if (lastDrag.capped === "max") note = t(calc.curve.noteMax, { agg: fmt(lastDrag.hi), atar: fmt(aggregateToAtar(lastDrag.hi), 2) });
      else if (lastDrag.capped === "min") note = t(calc.curve.noteMin, { agg: fmt(lastDrag.lo) });
      else note = t(calc.curve.noteMoved, { who: who(lastDrag.n, true), delta: signed(lastDrag.delta), each: lastDrag.n > 1 ? (lastDrag.clipped ? calc.curve.onAverage : calc.curve.each) : "" }) + (lastDrag.clipped ? calc.curve.noteClipped : "");
    } else note = t(calc.curve.noteIdle, { who: who(nFocus, false) });
  }
  const legend = (x: typeof E) => (x ? t(calc.curve.legend.value, { agg: fmt(x.agg), atar: fmt(x.atar, 2) }) : calc.curve.legend.notSaved);

  return (
    <Section id="curve" kicker={site.kickers.curve} title={calc.curve.title} intro={calc.curve.intro}>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="grid gap-5">
        <Glass className="rise p-3 sm:p-4">
          <CurveChart expected={E?.agg ?? null} target={T?.agg ?? null} />
          <div className="mt-2 flex items-center gap-3 border-t border-border/10 px-1 pt-3">
            <label htmlFor="aggRange" className="text-[0.8rem] whitespace-nowrap text-foreground-3">{calc.curve.aggregateLabel}</label>
            <Range
              id="aggRange" min={0} max={MAX_AGGREGATE} step={0.5} value={Number(c.aggregate.toFixed(1))} disabled={!has}
              onPointerDown={() => calcState.beginDrag()} onPointerUp={() => calcState.endDrag()}
              onChange={(e) => calcState.driveTo(Number(e.target.value))}
              onKeyUp={() => calcState.endDrag()}
            />
            <NumInput aria-label={calc.curve.aggregateLabel} value={Math.round(c.aggregate * 10) / 10} min={0} max={MAX_AGGREGATE} step={0.5} className="input-sm" disabled={!has}
              onCommit={(v) => { if (v !== null && v >= 0 && v <= MAX_AGGREGATE) setAggregate(v); }} />
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 px-1 text-[0.78rem] text-foreground-3">
            <li className="flex items-center gap-1.5"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-accent-fill" />{calc.curve.legend.whatIf} — <b className="text-foreground-2 num">{fmt(c.aggregate)}</b></li>
            <li className="flex items-center gap-1.5"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-[hsl(var(--expected))]" />{calc.curve.legend.expected} — <b className="text-foreground-2 num">{legend(E)}</b></li>
            <li className="flex items-center gap-1.5"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-[hsl(var(--target))]" />{calc.curve.legend.target} — <b className="text-foreground-2 num">{legend(T)}</b></li>
          </ul>
        </Glass>
        <ImpactPanel />
        </div>

        <Glass as="aside" className="p-5" aria-label={calc.curve.whatIfAtar}>
          <AtarBox id="liveAtarIn" big label={calc.curve.whatIfAtar} value={has ? c.atar : null}
            onSet={(v) => { const a = v === null ? null : inRange(v, 0, 99.95); if (a !== null) setAggregate(atarToAgg(a)); }} />
          <p className="mt-1.5 text-[0.84rem] text-foreground-2">{t(calc.curve.liveAgg, { agg: fmt(c.aggregate) })}</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <AtarBox id="expAtarIn" label={calc.curve.expectedAtar} value={E?.atar ?? null} placeholder={calc.curve.notSet} onSet={(v) => void setGoal("expected", v)} />
            <AtarBox id="tgtAtarIn" label={calc.curve.targetAtar} value={T?.atar ?? null} placeholder={calc.curve.notSet} onSet={(v) => void setGoal("target", v)} />
          </div>
          <p className="mt-2 text-[0.8rem] text-foreground-3" aria-live="polite"><GoalNote /></p>

          <h3 className="mt-5 text-[1rem] font-semibold">{calc.curve.focusTitle}</h3>
          <p className="mb-2 text-[0.8rem] text-foreground-3">{calc.curve.focusHelp}</p>
          {rows.length ? (
            <ul>
              {rows.map((r) => {
                const s = r.s, exp = inRange(s.expected, 0, 100), diff = exp === null ? null : r.external - exp;
                const d = diff === null ? t(calc.curve.focusNoExpected, { internal: fmt(r.used.mark) })
                  : Math.abs(diff) < 0.05 ? t(calc.curve.focusOnExpected, { exp: fmt(exp) })
                  : t(diff > 0 ? calc.curve.focusAbove : calc.curve.focusBelow, { diff: signed(diff), exp: fmt(exp) });
                return (
                  <li key={s.uid}>
                    <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-x-2.5 border-t border-border/8 py-2 text-[0.86rem] first:border-t-0">
                      <input type="checkbox" checked={s.focus} onChange={(e) => { update((dd) => { dd.subjects.find((x) => x.uid === s.uid)!.focus = e.target.checked; }); clearDrag(); }} />
                      <span className={s.focus ? "text-foreground-2" : "text-foreground-3"}>{displayName(s)}</span>
                      <span className={`num ${s.focus ? "font-semibold" : "text-foreground-3"}`}>{fmt(r.external)}%</span>
                      <span className={`col-start-2 col-end-4 text-[0.75rem] ${diff !== null && diff > 0.05 ? "text-loss" : diff !== null && diff < -0.05 ? "text-gain" : "text-foreground-3"}`}>{d}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-[0.8rem] text-foreground-3">{calc.curve.focusEmpty}</p>}
          <div className="mt-2.5 flex gap-2">
            <button type="button" className="btn" onClick={() => { update((d) => d.subjects.forEach((s) => (s.focus = true))); clearDrag(); }}>{calc.curve.tickAll}</button>
            <button type="button" className="btn" onClick={() => { update((d) => d.subjects.forEach((s) => (s.focus = false))); clearDrag(); }}>{calc.curve.untickAll}</button>
          </div>
          {note && <p className="mt-3.5 border-t border-border/10 pt-3 text-[0.84rem] text-foreground-2" aria-live="polite">{note}</p>}
        </Glass>
      </div>
    </Section>
  );
}

/* ---------------- where marks matter most ---------------- */
function ImpactPanel() {
  const { data, c } = useCalc();
  const k = calc.impact;
  const impact = useMemo(() => examImpact(data, k.step), [data, k.step]);
  const max = Math.max(0.01, ...impact.map((x) => x.atarDelta));
  return (
    <Glass className="rise p-4 sm:p-5" style={{ "--i": 2 } as CSSProperties} aria-labelledby="impact-h">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="impact-h" className="text-[1.05rem] font-semibold">{k.title}</h3>
        <span className="flag !ml-0">{k.estimate}</span>
      </div>
      <p className="mb-3.5 text-[0.8rem] text-foreground-3">{k.intro}</p>
      {!impact.length ? <p className="text-[0.86rem] text-foreground-3">{k.empty}</p> : (
        <ol aria-label={k.listLabel} className="space-y-2.5">
          {impact.map((x, rank) => {
            const s = data.subjects.find((y) => y.uid === x.uid)!;
            const i = data.subjects.indexOf(s);
            const mostlyOut = x.added > 0 && x.atarDelta < max * 0.4 && (c.countedBy[s.uid] ?? 0) < s.units;
            return (
              <li key={x.uid} className="impact-row grid grid-cols-[1.3rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1">
                <span aria-hidden="true" className="text-[0.74rem] text-foreground-3 num">{rank + 1}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <i aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: subjectColour(i) }} />
                  <span className="truncate text-[0.86rem]">{displayName(s)}</span>
                </span>
                <span className="text-right text-[0.86rem] font-semibold num">{x.added > 0 ? t(k.gain, { atar: fmt(x.atarDelta, 2) }) : k.none}</span>
                <span aria-hidden="true" />
                <span className="impact-bar col-span-2 !h-1.5"><i style={{ transform: `scaleX(${Math.max(0, x.atarDelta) / max})` }} /></span>
                {mostlyOut && <span className="col-start-2 col-end-4 text-[0.72rem] text-dropped">{k.notCounted}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </Glass>
  );
}

/* ---------------- smart plan ---------------- */
function PlanSection() {
  const { data, c, update, clearDrag } = useCalc();
  const { toast } = useFeedback();
  const k = calc.plan;
  const T = scenarioAgg(data, "target");
  const [want, setWant] = useState<number>(() => Math.min(99.95, Math.round((T?.atar ?? c.atar + 5) * 20) / 20));
  // Deferred so dragging the pin never waits on the planner (~5 ms, but per frame).
  const deferred = useDeferredValue(data);
  const ticked = deferred.subjects.filter((s) => s.focus).length;
  const plan = useMemo(() => planFor(deferred, want), [deferred, want]);
  const rows = deferred.subjects.filter((s) => plan.marks[s.uid] !== undefined && s.focus)
    .map((s) => ({ s, from: plan.marks[s.uid]! - (plan.added[s.uid] ?? 0), to: plan.marks[s.uid]!, add: plan.added[s.uid] ?? 0 }))
    .sort((a, b) => b.add - a.add);
  const maxAdd = Math.max(1, ...rows.map((r) => r.add));
  const saved = plan.evenTotal === null ? null : plan.evenTotal - plan.total;
  const apply = () => {
    update((d) => { for (const s of d.subjects) if (plan.added[s.uid]) s.exam = plan.marks[s.uid]!; });
    clearDrag(); toast(k.applied);
  };
  return (
    <Section id="plan" kicker={site.kickers.plan} title={k.title} intro={k.intro}>
      <Glass className="rise grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <label className="field" htmlFor="planTarget">{k.target}
            <NumInput id="planTarget" min={0} max={99.95} step={0.05} value={want}
              className="!max-w-[200px] !border-b-[3px] !border-b-accent-fill !py-1 !text-[2.2rem] font-semibold tracking-[-0.03em]"
              onCommit={(v) => { if (v !== null && v >= 0 && v <= 99.95) setWant(v); }} />
          </label>
          {T && Math.abs(T.atar - want) > 0.01 && <button type="button" className="btn mt-2.5" onClick={() => setWant(Math.round(T.atar * 100) / 100)}>{k.useTarget}</button>}
          <div className="mt-5 space-y-2 text-[0.9rem]" aria-live="polite">
            {!ticked ? <p className="text-foreground-3">{k.needTicked}</p>
              : plan.total === 0 && plan.reached ? <p>{t(k.zero, { atar: fmt(want, 2) })}</p>
              : !plan.reached ? <p className="text-warn">{t(k.unreachable, { atar: fmt(plan.atar, 2) })}</p>
              : <>
                  <p className="text-[1.05rem]"><b className="text-[1.6rem] font-semibold tracking-[-0.02em] num"><TweenNum value={plan.total} digits={0} /></b> {t(k.result, { atar: fmt(want, 2) })}</p>
                  <p className="text-foreground-2">{plan.evenTotal === null ? k.evenUnreachable : saved !== null && saved >= 0.5 ? t(k.saving, { even: fmt(plan.evenTotal, 0), saved: fmt(saved, 0) }) : k.noSaving}</p>
                </>}
          </div>
          <p className="mt-4 text-[0.76rem] text-foreground-3"><span className="flag !ml-0 mr-1.5">{k.estimate}</span>{k.assumption}</p>
        </div>
        <div>
          <ol aria-label={k.listLabel} className="space-y-2.5">
            {rows.map(({ s, from, to, add }) => (
              <li key={s.uid} className="impact-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                <span className="flex min-w-0 items-center gap-2">
                  <i aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: subjectColour(data.subjects.findIndex((x) => x.uid === s.uid)) }} />
                  <span className="truncate text-[0.88rem]">{displayName(s)}</span>
                  <span className="hidden text-[0.75rem] text-foreground-3 sm:inline num">{add ? t(k.row, { from: fmt(from, 0), to: fmt(to, 0) }) : ""}</span>
                </span>
                <span className={`text-right text-[0.88rem] font-semibold num ${add ? "" : "text-foreground-3 font-normal"}`}>{add ? t(k.gain, { n: fmt(add, 0) }) : k.unchanged}</span>
                <span className="impact-bar col-span-2 !h-1.5"><i style={{ transform: `scaleX(${add / maxAdd})` }} /></span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-primary mt-5" disabled={!plan.reached || plan.total === 0} onClick={apply}>{k.apply}</button>
        </div>
      </Glass>
    </Section>
  );
}

/* ---------------- projection ---------------- */
/** Blended mark on the HSC band ladder (approximate: NESA bands use aligned marks). */
function BandTrack({ internal, blended }: { internal: number; blended: number }) {
  const p = calc.projection;
  const lo = 40, x = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (100 - lo)) * 100))}%`;
  const next = nextBand(internal, blended);
  const segs = [{ from: lo, to: BAND_FLOORS[0], n: 1 }, ...BAND_FLOORS.map((f, i) => ({ from: f as number, to: (BAND_FLOORS[i + 1] ?? 100) as number, n: i + 2 }))];
  return (
    <div className="mt-3">
      <div className="band-track" role="img" aria-label={`${p.bandTrack}: ${fmt(blended)}%`}>
        {segs.map((g) => (
          <span key={g.n} className="band-seg" data-on={(g.n === 1 ? blended < g.to : blended >= g.from) && (blended < g.to || g.to === 100)} style={{ left: x(g.from), width: `calc(${x(g.to)} - ${x(g.from)})` }}>
            <span aria-hidden="true">{t(p.bandLabel, { n: g.n })}</span>
          </span>
        ))}
        <i className="band-marker" style={{ left: x(blended) }} aria-hidden="true" />
      </div>
      <p className="mt-1.5 flex justify-between gap-2 text-[0.75rem] text-foreground-3">
        <span>{blended >= 90 ? p.bandTop : next ? t(p.bandNext, { band: next.band, exam: fmt(next.exam, next.exam % 1 ? 1 : 0) }) : p.bandOut}</span>
        <span>{p.bandNote}</span>
      </p>
    </div>
  );
}

function ProjectionCard({ s, i }: { s: Subject; i: number }) {
  const { c, update } = useCalc();
  const r = c.rows.find((x) => x.s.uid === s.uid)!;
  const p = calc.projection;
  const exp = inRange(s.expected, 0, 100), tgt = inRange(s.target, 0, 100);
  const cnt = c.countedBy[s.uid] ?? 0;
  const name = displayName(s) || site.labels.unnamed;
  const setExam = (v: number | null) => update((d) => { d.subjects.find((x) => x.uid === s.uid)!.exam = v === null ? null : Math.round(Math.max(0, Math.min(100, v)) * 2) / 2; });
  const diff = r.valid ? r.scaled100 - r.blended : 0;
  const share = r.valid && r.used.mark! + r.external > 0 ? (r.used.mark! / (r.used.mark! + r.external)) * 100 : 50;
  return (
    <Glass as="article" className={`rise lift glass-sm border-t-[3px] p-4 ${!r.valid ? "opacity-70" : ""} ${r.valid && cnt < s.units ? "!border-dashed" : ""}`} style={{ borderTopColor: subjectColour(i), "--i": i } as CSSProperties} aria-label={name}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{name}</span>
        <span className="text-[0.78rem] whitespace-nowrap text-foreground-3">{unitsLabel(s.units)}</span>
      </div>
      {!r.valid ? <p className="mt-1 text-[0.82rem] text-loss">{p.noInternal}</p> : (
        <>
          <p className="mt-1 mb-2 text-[0.82rem] text-foreground-2">
            {t(p.internal, { mark: fmt(r.used.mark) })}
            {r.used.moderated && <span className="flag">{t(p.moderated, { mark: fmt(r.info.mark) })}</span>}
            {isEstimate(s) && <span className="flag">{p.scalingEstimated}</span>}
          </p>
          <p className="mb-2 flex min-h-[1em] flex-wrap items-center gap-2.5 text-[0.78rem] text-foreground-3">
            {exp !== null && <span>{p.chipExpected} <b className="text-foreground num">{fmt(exp)}%</b></span>}
            {tgt !== null && <span>{p.chipTarget} <b className="text-foreground num">{fmt(tgt)}%</b></span>}
            {exp !== null && tgt !== null && <span>{p.chipGap} <b className="text-foreground num">{signed(tgt - exp)}</b></span>}
            {s.focus && <span className="pill">{p.chipMoved}</span>}
          </p>
        </>
      )}
      <div className="flex items-center gap-3">
        <Range min={0} max={100} step={0.5} disabled={!r.valid} value={r.valid ? r.external : 0}
          aria-label={t(p.examLabel, { name })} onChange={(e) => setExam(Number(e.target.value))} />
        <NumInput aria-label={t(p.examLabel, { name })} className="input-sm" min={0} max={100} step={0.5} disabled={!r.valid}
          value={r.valid ? Math.round(r.external * 10) / 10 : null} onValue={(v) => { if (v !== null && v >= 0 && v <= 100) setExam(v); }} onCommit={(v) => setExam(v)} />
      </div>
      {r.valid && (
        <>
          <div className="mix mt-3.5 mb-1.5" aria-hidden="true">
            <span className="bg-internal" style={{ width: `${share}%` }}>{p.mixInternal}</span>
            <span className="bg-exam" style={{ width: `${100 - share}%` }}>{p.mixExam}</span>
          </div>
          <div className="mb-3 flex justify-between gap-2 text-[0.74rem] text-foreground-3">
            <span>{t(p.banked, { pts: fmt(r.rawIntUnit * cnt) })}</span><span>{t(p.fromExam, { pts: fmt(r.rawExamUnit * cnt) })}</span>
          </div>
          <dl className="text-[0.86rem]">
            {[[p.blended, `${fmt(r.blended)}%`], [p.afterScaling, t(p.outOf100, { v: fmt(r.scaled100) })], [p.adds, t(p.addsValue, { pts: fmt(r.unitValue * cnt), n: cnt, units: unitsLabel(s.units) })]].map(([k, val], j) => (
              <div key={j} className={`flex justify-between gap-2 py-1 ${j === 0 ? "border-t border-border/10 pt-2.5" : ""}`}>
                <dt className="text-foreground-2">{k}</dt><dd className="text-right font-semibold num">{val}</dd>
              </div>
            ))}
          </dl>
          <BandTrack internal={r.used.mark!} blended={r.blended} />
          <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-foreground/8" aria-hidden="true">
            <i className="absolute inset-y-0 left-0 block bg-foreground-3/60 transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, r.blended))}%` }} />
            <i className={`absolute inset-y-0 left-0 block opacity-85 transition-[width] duration-500 ${diff >= 0 ? "bg-gain" : "bg-loss"}`} style={{ width: `${Math.max(0, Math.min(100, r.scaled100))}%` }} />
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[0.86rem]">
            <span className="text-foreground-2">{p.effect}</span>
            <span className={`rounded-md px-2 py-0.5 text-[0.8rem] font-semibold ${diff >= 0 ? "bg-gain/12 text-gain" : "bg-loss/12 text-loss"}`}>
              <span aria-hidden="true">{diff >= 0 ? "▲ " : "▼ "}</span>{t(diff >= 0 ? p.gained : p.lost, { pts: signed(diff) })}
            </span>
          </div>
          {cnt < s.units && <p className="mt-3 rounded-lg border border-dashed border-dropped px-2.5 py-1.5 text-[0.78rem] font-semibold text-dropped">{t(p.dropped, { n: s.units - cnt, units: unitsLabel(s.units) })}</p>}
        </>
      )}
    </Glass>
  );
}

function ProjectionSection() {
  const { data, c, update, clearDrag, undo } = useCalc();
  const { toast } = useFeedback();
  const p = calc.projection;
  const save = (field: GoalField) => {
    const label = site.labels[field];
    const valid = c.rows.filter((r) => r.valid);
    if (!valid.length) { toast(site.toasts.needInternal); return; }
    const hadSet = data.subjects.some((s) => inRange(s[field], 0, 100) !== null);
    update((d) => { for (const r of valid) { const s = d.subjects.find((x) => x.uid === r.s.uid)!; s[field] = Math.round(examOf(s, r.used.mark!) * 10) / 10; } });
    // Replacing an existing set is undoable, so no up-front confirmation (Apple: forgiveness over friction).
    toast(t(site.toasts.saved, { n: valid.length, label }), hadSet ? { label: site.toasts.undo, run: undo } : undefined);
  };
  const load = (field: GoalField) => {
    const label = site.labels[field];
    if (!data.subjects.some((s) => inRange(s[field], 0, 100) !== null)) { toast(t(site.toasts.noneSaved, { label })); return; }
    update((d) => { for (const s of d.subjects) if (inRange(s[field], 0, 100) !== null) s.exam = s[field]; }); clearDrag();
    toast(t(site.toasts.loaded, { label }));
  };
  return (
    <Section id="projection" kicker={site.kickers.projection} title={p.title} intro={p.intro}>
      <Glass className="glass-sm mb-4 flex flex-wrap items-center justify-between gap-3.5 px-4 py-3.5">
        <p className="max-w-[50ch] text-[0.86rem] text-foreground-2"><b className="text-foreground">{p.scenLead}</b> {p.scenText.replace(p.scenLead, "").trim()}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => save("expected")}>{p.saveExp}</button>
          <button type="button" className="btn" onClick={() => save("target")}>{p.saveTgt}</button>
          <button type="button" className="btn" onClick={() => load("expected")}>{p.loadExp}</button>
          <button type="button" className="btn" onClick={() => load("target")}>{p.loadTgt}</button>
          <button type="button" className="btn" onClick={() => { update((d) => d.subjects.forEach((s) => (s.exam = null))); clearDrag(); toast(site.toasts.reset); }}>{p.reset}</button>
        </div>
      </Glass>
      <Glass className="glass-sm mb-4 grid grid-cols-2 gap-px overflow-hidden !p-0 md:grid-cols-4">
        <Stat className="p-4" value={<TweenNum value={c.aggregate} />} label={p.stats.agg} />
        <Stat className="p-4" value={<TweenNum value={c.counted.length ? c.atar : null} digits={2} />} label={p.stats.atar} />
        <Stat className="p-4" value={<TweenNum value={c.rawInternal} />} label={p.stats.banked} />
        <Stat className="p-4" value={<TweenNum value={c.rawExam} />} label={p.stats.fromExams} />
      </Glass>
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
        {data.subjects.map((s, i) => <ProjectionCard key={s.uid} s={s} i={i} />)}
      </div>
    </Section>
  );
}

/* ---------------- compare ---------------- */
function CompareSection() {
  const { data, c, update } = useCalc();
  const k = calc.compare;
  const E = scenarioAgg(data, "expected"), T = scenarioAgg(data, "target");
  const show = (x: typeof E, key: "agg" | "atar", d: number) => (x ? `${fmt(x[key], d)}${x.partial ? "*" : ""}` : site.labels.dash);
  const set = (uid: string, f: GoalField, v: number | null) => update((d) => { d.subjects.find((s) => s.uid === uid)![f] = v; });
  return (
    <Section id="compare" title={k.title} intro={k.intro}>
      <Glass className="glass-sm tscroll">
        <table className="datatable min-w-[640px]">
          <thead><tr>{Object.values(k.cols).map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {c.rows.map((r) => {
              const e = inRange(r.s.expected, 0, 100), tg = inRange(r.s.target, 0, 100), name = displayName(r.s) || site.labels.unnamed;
              const gap = e !== null && tg !== null ? tg - e : null;
              return (
                <tr key={r.s.uid}>
                  <th scope="row" className="!text-left !text-[0.86rem] !font-normal !text-foreground">{name} <span className="text-[0.82em] text-foreground-3">{t(calc.projection.unitsShort, { n: r.s.units })}</span></th>
                  <td className="text-foreground-2">{r.valid ? `${fmt(r.used.mark)}%` : site.labels.dash}</td>
                  <td><NumInput className="input-sm ml-auto" min={0} max={100} step={0.5} placeholder={site.labels.dash} aria-label={t(k.expLabel, { name })} value={e} onValue={(v) => set(r.s.uid, "expected", v)} /></td>
                  <td><NumInput className="input-sm ml-auto" min={0} max={100} step={0.5} placeholder={site.labels.dash} aria-label={t(k.tgtLabel, { name })} value={tg} onValue={(v) => set(r.s.uid, "target", v)} /></td>
                  <td className={gap === null ? "" : gap > 0.05 ? "font-semibold text-loss" : gap < -0.05 ? "font-semibold text-gain" : ""}>{gap === null ? site.labels.dash : signed(gap)}</td>
                  <td className="text-foreground-2">{r.valid ? `${fmt(r.external)}%` : site.labels.dash}</td>
                </tr>
              );
            })}
          </tbody>
          <tbody>
            <tr className="total"><td>{k.aggRow}</td><td /><td>{show(E, "agg", 1)}</td><td>{show(T, "agg", 1)}</td><td>{E && T ? signed(T.agg - E.agg) : site.labels.dash}</td><td>{fmt(c.aggregate)}</td></tr>
            <tr className="total"><td>{k.atarRow}</td><td /><td>{show(E, "atar", 2)}</td><td>{show(T, "atar", 2)}</td><td>{E && T ? signed(T.atar - E.atar, 2) : site.labels.dash}</td><td>{c.counted.length ? fmt(c.atar, 2) : site.labels.dash}</td></tr>
          </tbody>
        </table>
      </Glass>
      <p className="mt-2 text-[0.78rem] text-foreground-3">{E?.partial || T?.partial ? k.partial : !E && !T ? k.none : ""}</p>
    </Section>
  );
}

/* ---------------- units + split ---------------- */
function UnitsSection() {
  const { c } = useCalc();
  const u = calc.units;
  const strip = c.counted.slice().sort((a, b) => b.value - a.value);
  const empty = COUNTING_UNITS - strip.length;
  return (
    <Section id="units">
      <Glass className="p-4 sm:p-5">
        <h3 className="text-[1.1rem] font-semibold">{u.title}</h3>
        <p className="mt-1 mb-3.5 text-[0.82rem] text-foreground-3">{u.hint}</p>
        <ol className="flex flex-wrap gap-1.5">
          {strip.map((x, k) => {
            const mand = c.counted.indexOf(x) < 2 && x.english;
            return (
              <li key={k} className="glass-inset relative min-w-[78px] flex-[1_1_78px] p-2.5">
                <span className="block truncate text-[0.7rem] text-foreground-3">{displayName(x.r.s)}</span>
                <span className="font-semibold num">{fmt(x.value)}</span>
                {mand && <span className="absolute -top-px -right-px rounded-tr-[14px] rounded-bl-lg bg-internal px-1.5 text-[0.6rem] font-semibold text-on-fill">{u.englishBadge}</span>}
              </li>
            );
          })}
          {Array.from({ length: Math.max(0, empty) }, (_, k) => (
            <li key={`e${k}`} className="grid min-w-[78px] flex-[1_1_78px] place-items-center rounded-[14px] border border-dashed border-input-border p-2.5 text-[0.75rem] text-foreground-3">{u.empty}</li>
          ))}
        </ol>
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5 border-t border-dashed border-dropped/60 pt-3 text-[0.83rem] text-dropped">
          {c.notCounted.length ? (
            <><span>{u.notCounted}</span>{c.notCounted.map((n, k) => <span key={k} className="rounded-lg border border-dashed border-dropped px-2.5 py-1 font-semibold">{t(u.chip, { name: displayName(n.u.r.s), pts: fmt(n.u.value) })}</span>)}</>
          ) : <span>{empty > 0 ? t(empty === 1 ? u.slots1 : u.slots, { n: empty }) : u.allCount}</span>}
        </div>
      </Glass>
    </Section>
  );
}

function SplitSection() {
  const { c } = useCalc();
  const s = calc.split;
  const n = c.counted.length, capPts = n * 25;
  const half = (cls: string, label: string, pts: number, foot: string) => (
    <div className={`glass-inset border-t-[3px] p-4 ${cls}`}>
      <p className="text-[0.82rem] text-foreground-2">{label}</p>
      <p className="text-[2rem] leading-tight font-semibold tracking-[-0.02em] num">{fmt(pts)} <span className="text-[0.95rem] font-normal text-foreground-3">{s.of250}</span></p>
      <div className="meter mt-2.5" aria-hidden="true"><i className={cls.includes("internal") ? "bg-internal" : "bg-exam"} style={{ width: `${Math.min(100, (pts / 250) * 100)}%` }} /></div>
      <p className="mt-2 text-[0.78rem] text-foreground-3">{foot}</p>
    </div>
  );
  return (
    <Section id="split" title={s.title} intro={s.intro}>
      <Glass className="p-4 sm:p-5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          {half("border-t-internal internal", s.internal, c.rawInternal, n < 10 ? t(n === 1 ? s.intFewUnits1 : s.intFewUnits, { n, cap: capPts }) : t(s.intFull, { pct: fmt(c.rawInternal / 2.5) }))}
          {half("border-t-exam", s.exam, c.rawExam, t(s.extFoot, { pct: fmt(c.rawExam / 2.5) }))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3.5 border-t border-border/10 pt-4 text-[0.9rem]">
          <span>{s.rawAgg} <b className="num">{fmt(c.rawAggregate)}</b> {s.of500}</span>
          <span className="text-foreground-3" aria-hidden="true">{s.arrow}</span>
          <span>{s.countsAs} <b className="text-accent num">{fmt(c.aggregate)}</b> {s.of500}</span>
          <span className="flex-[1_1_260px] text-[0.82rem] text-foreground-3">{s.note}</span>
        </div>
      </Glass>
    </Section>
  );
}

/** Common path first (Apple: simplicity, not minimalism): the detailed tables live one level deeper. */
function Breakdown() {
  const b = calc.breakdown;
  return (
    <section className="mb-14" aria-labelledby="breakdown-h">
      <p className="kicker mb-2 flex items-center gap-2.5"><span aria-hidden="true" className="inline-block h-px w-6 bg-accent/70" />{site.kickers.breakdown}</p>
      <details className="breakdown group">
        <summary className="glass lift flex items-center justify-between gap-4 p-5 sm:p-6">
          <span>
            <span id="breakdown-h" className="block text-[clamp(1.35rem,2.6vw,1.75rem)] font-semibold tracking-[-0.025em]">{b.title}</span>
            <span className="mt-1 block max-w-[62ch] text-[0.92rem] text-foreground-2">{b.summary}</span>
          </span>
          <span className="chev grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground/[0.07]" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </span>
        </summary>
        <div className="pt-8">
          <CompareSection />
          <UnitsSection />
          <SplitSection />
        </div>
      </details>
    </section>
  );
}

export function Calculator() {
  const { data, replace, undo } = useCalc();
  const { toast } = useFeedback();
  const loadTest = () => {
    const had = data.subjects.length > 0;
    replace(sampleData());
    toast(site.toasts.testLoaded, had ? { label: site.toasts.undo, run: undo } : undefined);
  };
  return (
    <>
      <Steps />
      <Checks />
      {!data.subjects.length ? <EmptyState onTest={loadTest} /> : (
        <>
          <CurveSection />
          <ProjectionSection />
          <Breakdown />
          <PlanSection />
        </>
      )}
    </>
  );
}
