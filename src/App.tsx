import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import site from "../content/site.json";
import { Backdrop } from "./components/Backdrop.tsx";
import { Calculator } from "./components/Calculator.tsx";
import { FeedbackProvider } from "./components/Feedback.tsx";
import { Header } from "./components/Header.tsx";
import { HowItWorks } from "./components/HowItWorks.tsx";
import { Subjects } from "./components/Subjects.tsx";
import { NavCtx, type Nav, type TabKey } from "./lib/nav.ts";
import { CalculatorProvider, useCalc } from "./lib/state.tsx";
import { t } from "./lib/text.ts";

const ORDER: TabKey[] = ["calc", "subj", "help"];
const fromHash = (): TabKey => ORDER.find((k) => `#${site.tabs[k].hash}` === window.location.hash) ?? "calc";
const motion = (): ScrollBehavior => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

function Shell() {
  const { data, v } = useCalc();
  const [tab, setTab] = useState<TabKey>(fromHash);
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({ calc: null, subj: null, help: null });

  useEffect(() => {
    const sync = () => setTab(fromHash());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const select = useCallback((k: TabKey) => {
    setTab(k);
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
          <div role="tablist" aria-label={site.tabs.label} className="glass tabs max-w-full">
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
