import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type React from "react";
import site from "../content/site.json";
import { Backdrop } from "./components/Backdrop.tsx";
import { Calculator } from "./components/Calculator.tsx";
import { FeedbackProvider } from "./components/Feedback.tsx";
import { Header } from "./components/Header.tsx";
import { Suspense, lazy } from "react";
import { decodeShare, readShareFromLocation } from "./lib/share.ts";
const Syllabuses = lazy(() => import("./components/Syllabuses.tsx"));
const loadSubjects = () => import("./components/Subjects.tsx");
const loadHelp = () => import("./components/HowItWorks.tsx");
const Subjects = lazy(() => loadSubjects().then((m) => ({ default: m.Subjects })));
const HowItWorks = lazy(() => loadHelp().then((m) => ({ default: m.HowItWorks })));

/** Runs `fn(el)` once an element exists (lazy tabs mount a frame or two later). */
function whenElement(id: string, fn: (el: HTMLElement) => void, tries = 90) {
  const el = document.getElementById(id);
  if (el) fn(el);
  else if (tries > 0) requestAnimationFrame(() => whenElement(id, fn, tries - 1));
}
import { withTransition } from "./lib/motion.ts";
import { NavCtx, type Nav, type TabKey } from "./lib/nav.ts";
import { useFeedback } from "./components/Feedback.tsx";
import { CalculatorProvider, useCalc } from "./lib/state.tsx";
import { t } from "./lib/text.ts";

const ORDER: TabKey[] = ["calc", "subj", "syl", "help"];
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
  const { data, v, undo, redo, replace } = useCalc();
  const { toast, confirm } = useFeedback();
  const [tab, setTab] = useState<TabKey>(fromHash);
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({ calc: null, subj: null, syl: null, help: null });
  const glide = useGlider(tab, tabRefs);
  // Lazy tabs stay mounted once visited, so their local state (open panels) survives tab switches.
  const [visited, setVisited] = useState<Set<TabKey>>(() => new Set([fromHash()]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));
  // Scroll edge effect only while the tab bar is actually floating over content.
  useEffect(() => {
    const nav = document.getElementById("tabs");
    if (!nav) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { nav.dataset.stuck = String(nav.getBoundingClientRect().top <= 13 && window.scrollY > 0); });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  // Fetch the other tabs while the browser is idle, so switching is instant.
  useEffect(() => {
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(cb, { timeout: 3000 }) : globalThis.setTimeout(cb, 1500));
    idle(() => { void loadSubjects(); void loadHelp(); });
  }, []);

  // Opening a share link: decode (hostile input), ask, replace (undoable), then
  // clear the fragment so the marks don't linger in the address bar or history.
  useEffect(() => {
    const open = () => {
      const payload = readShareFromLocation();
      if (!payload) return;
      history.replaceState(null, "", `${location.pathname}#${site.tabs.calc.hash}`);
      setTab("calc");
      decodeShare(payload).then(async (d) => {
        const n = d.subjects.length;
        if (!n) { toast(site.share.bad); return; }
        if (await confirm(n === 1 ? site.share.openConfirm1 : t(site.share.openConfirm, { n }))) { replace(d); toast(site.share.opened); }
      }).catch((e: unknown) => toast(e instanceof Error && e.message === "too-large" ? site.share.tooLarge : site.share.bad));
    };
    open();
    // A share link pasted into a tab that already has the site open only changes the fragment.
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [confirm, replace, toast]);

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
      document.getElementById("tabs")?.scrollIntoView({ block: "start", behavior: motion() });
      if (focusId) whenElement(focusId, (el) => el.focus({ preventScroll: true }));
    },
    jumpToSubject: (uid) => {
      select("subj");
      whenElement(`card-${uid}`, (el) => {
        el.scrollIntoView({ block: "center", behavior: motion() });
        document.getElementById(`im-${uid}`)?.focus({ preventScroll: true });
      });
    },
    scrollTo: (id) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: motion() }),
  }), [select]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = ORDER.indexOf(tab);
    const n = ORDER.length;
    const next = { ArrowRight: ORDER[(i + 1) % n], ArrowLeft: ORDER[(i + n - 1) % n], Home: ORDER[0], End: ORDER[n - 1] }[e.key];
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
                <span className="sm:hidden">{site.tabs[k].short}</span>
                <span className="hidden sm:inline">{site.tabs[k].label}</span>
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
          <div role="tabpanel" id="panel-subj" aria-labelledby="tab-subj" hidden={tab !== "subj"}>{visited.has("subj") && <Suspense fallback={null}><Subjects /></Suspense>}</div>
          <div role="tabpanel" id="panel-syl" aria-labelledby="tab-syl" hidden={tab !== "syl"}>{visited.has("syl") && <Suspense fallback={null}><Syllabuses /></Suspense>}</div>
          <div role="tabpanel" id="panel-help" aria-labelledby="tab-help" hidden={tab !== "help"}>{visited.has("help") && <Suspense fallback={null}><HowItWorks /></Suspense>}</div>
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
