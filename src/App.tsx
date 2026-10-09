import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type React from "react";
import site from "../content/site.json";
import { Backdrop } from "./components/Backdrop.tsx";
import { Calculator } from "./components/Calculator.tsx";
import { FeedbackProvider } from "./components/Feedback.tsx";
import { Header } from "./components/Header.tsx";
import { HowItWorks } from "./components/HowItWorks.tsx";
import { Subjects } from "./components/Subjects.tsx";
import { withTransition } from "./lib/motion.ts";
import { NavCtx, type Nav, type TabKey } from "./lib/nav.ts";
import { useFeedback } from "./components/Feedback.tsx";
import { CalculatorProvider, useCalc } from "./lib/state.tsx";
import { t } from "./lib/text.ts";

const ORDER: TabKey[] = ["calc", "subj", "help"];
const fromHash = (): TabKey => ORDER.find((k) => `#${site.tabs[k].hash}` === window.location.hash) ?? "calc";
const motion = (): ScrollBehavior => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/** Gliding pill under the selected tab; measured, so it follows any label width. */
function useGlider(tab: TabKey, refs: React.RefObject<Record<TabKey, HTMLButtonElement | null>>) {
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = refs.current[tab];
    if (!el) return;
    const measure = () => setBox({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el.parentElement!);
    return () => ro.disconnect();
  }, [tab, refs]);
  return box;
}

function Shell() {
  const { data, v, undo, redo } = useCalc();
  const { toast } = useFeedback();
  const [tab, setTab] = useState<TabKey>(fromHash);
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({ calc: null, subj: null, help: null });
  const glide = useGlider(tab, tabRefs);

  // Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z or Ctrl+Y redo — except inside text fields,
  // which keep their own native undo.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest("input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=true]")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); toast(undo() ? site.toolbar.undone : site.toolbar.nothingToUndo); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); toast(redo() ? site.toolbar.redone : site.toolbar.nothingToRedo); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, toast]);

  useEffect(() => {
    const sync = () => withTransition("tab", () => flushSync(() => setTab(fromHash())));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const select = useCallback((k: TabKey) => {
    withTransition("tab", () => flushSync(() => setTab(k)));
    const hash = `#${site.tabs[k].hash}`;
    if (window.location.hash !== hash) history.pushState(null, "", hash);
  }, []);

  const nav: Nav = useMemo(() => ({
    go: (k, focusId) => {
      select(k);
      requestAnimationFrame(() => {
        if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
        document.getElementById("tabs")?.scrollIntoView({ block: "start", behavior: motion() });
      });
    },
    jumpToSubject: (uid) => {
      select("subj");
      requestAnimationFrame(() => {
        document.getElementById(`card-${uid}`)?.scrollIntoView({ block: "center", behavior: motion() });
        document.getElementById(`im-${uid}`)?.focus({ preventScroll: true });
      });
    },
    scrollTo: (id) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: motion() }),
  }), [select]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = ORDER.indexOf(tab);
    const next = { ArrowRight: ORDER[(i + 1) % 3], ArrowLeft: ORDER[(i + 2) % 3], Home: ORDER[0], End: ORDER[2] }[e.key];
    if (!next) return;
    e.preventDefault(); select(next); tabRefs.current[next]?.focus();
  };
  const subjErr = v.issues.some((i) => i.level === "error" && i.uid);

  return (
    <NavCtx.Provider value={nav}>
      <a href="#main" className="skip">{site.skipLink}</a>
      <div className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6">
        <Header />
        <nav id="tabs" aria-label={site.tabs.label} className="no-print sticky top-3 z-10 my-6 flex scroll-mt-3 sm:justify-start">
          <div role="tablist" aria-label={site.tabs.label} className="glass tabs max-w-full" data-glide={glide !== null}>
            {glide && <span aria-hidden="true" className="tab-glider" style={{ width: glide.w, transform: `translateX(${glide.x}px)` }} />}
            {ORDER.map((k) => (
              <button
                key={k} ref={(el) => { tabRefs.current[k] = el; }} id={`tab-${k}`} role="tab" type="button" className="tab"
                aria-selected={tab === k} aria-controls={`panel-${k}`} tabIndex={tab === k ? 0 : -1}
                onClick={() => select(k)} onKeyDown={onKey}
              >
                {site.tabs[k].label}
                {k === "subj" && (
                  <span className="count num" data-error={subjErr}>
                    <span aria-hidden="true">{data.subjects.length}</span>
                    <span className="sr-only">{t(site.tabs.subj.countLabel, { n: data.subjects.length })}{subjErr ? `, ${site.tabs.subj.errorLabel}` : ""}</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
        <main id="main" tabIndex={-1} className="outline-none">
          <div role="tabpanel" id="panel-calc" aria-labelledby="tab-calc" hidden={tab !== "calc"}><Calculator /></div>
          <div role="tabpanel" id="panel-subj" aria-labelledby="tab-subj" hidden={tab !== "subj"}><Subjects /></div>
          <div role="tabpanel" id="panel-help" aria-labelledby="tab-help" hidden={tab !== "help"}>{tab === "help" && <HowItWorks />}</div>
        </main>
        <footer className="mt-6 border-t border-border/10 pt-5 text-[0.8rem] text-foreground-3">
          <p className="max-w-[90ch]">{site.footer.disclaimer}</p>
          <p className="mt-6 text-center text-[0.7rem] tracking-[0.18em] uppercase">{site.footer.credit}</p>
        </footer>
      </div>
    </NavCtx.Provider>
  );
}

export function App() {
  return (
    <CalculatorProvider>
      <FeedbackProvider>
        <Backdrop />
        <Shell />
      </FeedbackProvider>
    </CalculatorProvider>
  );
}
