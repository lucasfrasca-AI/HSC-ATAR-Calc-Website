// First-visit guide, in the spirit of Apple's TipKit: a small card that follows what the
// student is doing rather than marching them through a tour. The step is derived from the
// data (no subjects → add one; a subject without a mark → enter it; otherwise add the rest),
// so anything they do anywhere on the page moves it along, and nothing is ever blocked.
// Lazy: only first-time visitors (or the More menu) load it.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import g from "../../content/guide.json";
import { inRange } from "../lib/engine.ts";
import { useNav, type TabKey } from "../lib/nav.ts";
import { sampleData, useCalc } from "../lib/state.tsx";
import { t } from "../lib/text.ts";

type Phase = "welcome" | "flow" | "result";
const top = () => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

export default function Guide({ tab, onClose }: { tab: TabKey; onClose: () => void }) {
  const { data, v, replace } = useCalc();
  const nav = useNav();
  const card = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<Phase>(data.subjects.length ? "flow" : "welcome");

  // Task-by-task subjects compute their mark, so only simple entries can be "missing" one.
  const unmarked = data.subjects.find((s) => s.mode === "simple" && inRange(s.internalMark, 0, 100) === null);
  const step = phase === "result" ? "result" : !data.subjects.length ? "add" : unmarked ? "mark" : "more";
  const n = { add: 1, mark: 2, more: 3, result: 4 }[step];
  const target = step === "result" ? "readout" : step === "mark" ? `im-${unmarked!.uid}` : "addCourse";
  const course = unmarked?.name ?? "";

  // Spotlight the field this step is about, if it is on screen in the current tab.
  useEffect(() => {
    if (phase === "welcome") return;
    // Lazy tabs mount a few frames after switching, so look for the target for up to ~1.5 s.
    let el: HTMLElement | null = null, id = 0, tries = 90;
    const find = () => {
      el = document.getElementById(target);
      if (el?.offsetParent) el.classList.add("guide-spot");
      else if (tries-- > 0) id = requestAnimationFrame(find);
    };
    id = requestAnimationFrame(find);
    return () => { cancelAnimationFrame(id); el?.classList.remove("guide-spot"); };
  }, [phase, target, tab, data.subjects.length]);

  // Keep toasts above the card (phones stack them at the bottom).
  useLayoutEffect(() => {
    const el = card.current, root = document.documentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => root.style.setProperty("--guide-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--guide-h"); };
  }, []);

  const goSubjects = () => (step === "mark" ? nav.jumpToSubject(unmarked!.uid) : nav.go("subj", "addCourse"));
  const onTarget = step === "result" ? tab === "calc" : tab === "subj";
  const units = Math.min(v.totalUnits, 10);

  let title: string, body: string, actions: ReactNode = null;
  if (step === "add" && phase === "welcome") {
    title = g.welcome.title; body = g.welcome.body;
    actions = (<>
      <button type="button" className="btn btn-primary" onClick={() => { setPhase("flow"); nav.go("subj", "addCourse"); }}>{g.welcome.start}</button>
      <button type="button" className="btn" onClick={() => { replace(sampleData()); setPhase("result"); nav.go("calc"); top(); }}>{g.welcome.sample}</button>
      <button type="button" className="btn btn-quiet" onClick={onClose}>{g.welcome.explore}</button>
    </>);
  } else if (step === "add") {
    title = g.add.title; body = g.add.body;
    if (!onTarget) actions = <button type="button" className="btn btn-primary" onClick={goSubjects}>{g.add.go}</button>;
  } else if (step === "mark") {
    title = g.mark.title; body = t(g.mark.body, { course });
    if (!onTarget) actions = <button type="button" className="btn btn-primary" onClick={goSubjects}>{g.mark.go}</button>;
  } else if (step === "more") {
    title = g.more.title; body = v.eligible ? g.more.eligible : "";
    actions = (<>
      <button type="button" className={`btn ${v.eligible ? "btn-primary" : ""}`} onClick={() => { setPhase("result"); nav.go("calc"); top(); }}>{g.more.done}</button>
      {!onTarget && <button type="button" className="btn btn-quiet" onClick={goSubjects}>{g.more.go}</button>}
    </>);
  } else {
    title = g.result.title; body = g.result.body;
    actions = <button type="button" className="btn btn-primary" onClick={onClose}>{g.result.done}</button>;
  }

  return (
    <aside
      ref={card} className="guide no-print" aria-label={g.label}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="kicker">{phase === "welcome" ? g.label : t(g.progress, { n })}</p>
        <button type="button" className="guide-x" aria-label={g.close} onClick={onClose}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div aria-live="polite">
        <h2 className="mt-1.5 text-[1.02rem] leading-snug font-semibold tracking-[-0.01em]">{title}</h2>
        {body && <p className="mt-1.5 text-[0.86rem] leading-relaxed text-foreground-2">{body}</p>}
        {step === "more" && (
          <div className="mt-3">
            <div className="guide-meter" aria-hidden="true"><span style={{ "--w": `${units * 10}%` } as CSSProperties} /></div>
            <p className="mt-1.5 text-[0.78rem] text-foreground-3">{t(v.totalUnits >= 10 ? g.more.unitsEnough : g.more.units, { n: v.totalUnits })}</p>
          </div>
        )}
      </div>
      {actions && <div className="mt-3.5 flex flex-wrap gap-2">{actions}</div>}
    </aside>
  );
}
