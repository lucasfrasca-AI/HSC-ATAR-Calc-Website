import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** JS side of prefers-reduced-motion; CSS handles its own half in index.css. */
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);

export interface SpringControls {
  /** Put the spring at an on-screen value (e.g. under the pointer) with a velocity, so a later retarget starts from there. */
  jump: (x: number, velocity?: number) => void;
}

/**
 * A critically damped spring (damping ratio 1, Apple's default) that follows
 * `value`. Retargeting keeps the current position *and velocity*, so motion is
 * interruptible with no seam. `response` is Apple's response time in seconds,
 * not a duration. Integrated on requestAnimationFrame with small fixed substeps.
 * Returns the value instantly when motion is reduced.
 */
export function useSpring(value: number, response = 0.35, damping = 1): [number, SpringControls] {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const st = useRef({ x: value, v: 0, raf: 0, last: 0, target: value, w: (2 * Math.PI) / response, z: damping });

  const [controls] = useState(() => {
    const s = st.current;
    const step = (now: number) => {
      const dt = Math.min(0.064, (now - (s.last || now)) / 1000);
      s.last = now;
      for (let t = 0; t < dt; t += 1 / 240) {
        const h = Math.min(1 / 240, dt - t);
        s.v += (-s.w * s.w * (s.x - s.target) - 2 * s.z * s.w * s.v) * h;
        s.x += s.v * h;
      }
      const settled = Math.abs(s.x - s.target) < 1e-3 && Math.abs(s.v) < 1e-2;
      if (settled) { s.x = s.target; s.v = 0; }
      setShown(s.x);
      s.raf = settled ? 0 : requestAnimationFrame(step);
    };
    const kick = () => { if (!s.raf) { s.last = 0; s.raf = requestAnimationFrame(step); } };
    return {
      kick,
      jump: (x: number, velocity = 0) => { s.x = x; s.v = velocity; s.last = 0; setShown(x); kick(); },
    } as SpringControls & { kick: () => void };
  });

  useEffect(() => {
    const s = st.current;
    s.target = value; s.w = (2 * Math.PI) / response; s.z = damping;
    if (reduced || !Number.isFinite(value)) { s.x = value; s.v = 0; return; }
    if (Math.abs(s.x - value) > 1e-3) controls.kick();
  }, [value, response, damping, reduced, controls]);
  useEffect(() => () => cancelAnimationFrame(st.current.raf), []);

  return [reduced || !Number.isFinite(value) ? value : shown, controls];
}

/** Number display that springs to its new value. */
export function useTween(value: number, response = 0.35): number {
  return useSpring(value, response)[0];
}

type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
/**
 * Runs a DOM-changing callback inside a View Transition when the browser has
 * one and motion is allowed; otherwise just runs it. `kind` picks the CSS
 * animation (html[data-vt]). Progressive enhancement only — zero bytes of library.
 */
export function withTransition(kind: "tab" | "theme", change: () => void, origin?: { x: number; y: number }) {
  const doc = document as VTDoc;
  if (!doc.startViewTransition) { change(); return; }
  const root = document.documentElement;
  // Reduced motion still gets feedback: a short cross-fade, never a slide or a reveal,
  // and no abrupt brightness jump on a light/dark theme change.
  root.dataset.vt = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "fade" : kind;
  if (origin) {
    const r = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
    root.style.setProperty("--vt-x", `${origin.x}px`);
    root.style.setProperty("--vt-y", `${origin.y}px`);
    root.style.setProperty("--vt-r", `${r}px`);
  }
  doc.startViewTransition(change).finished.finally(() => { delete root.dataset.vt; });
}
