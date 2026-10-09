import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** JS side of prefers-reduced-motion; CSS handles its own half in index.css. */
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);

/** Eases a displayed number towards `value` with requestAnimationFrame. Jumps when motion is reduced. */
export function useTween(value: number, ms = 650): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || !Number.isFinite(value)) { from.current = value; return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - k, 3);
      const v = a + (value - a) * e;
      from.current = v; setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduced]);
  return reduced || !Number.isFinite(value) ? value : shown;
}

type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
/**
 * Runs a DOM-changing callback inside a View Transition when the browser has
 * one and motion is allowed; otherwise just runs it. `kind` picks the CSS
 * animation (html[data-vt]). Progressive enhancement only — zero bytes of library.
 */
export function withTransition(kind: "tab" | "theme", change: () => void, origin?: { x: number; y: number }) {
  const doc = document as VTDoc;
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { change(); return; }
  const root = document.documentElement;
  root.dataset.vt = kind;
  if (origin) {
    const r = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
    root.style.setProperty("--vt-x", `${origin.x}px`);
    root.style.setProperty("--vt-y", `${origin.y}px`);
    root.style.setProperty("--vt-r", `${r}px`);
  }
  doc.startViewTransition(change).finished.finally(() => { delete root.dataset.vt; });
}
