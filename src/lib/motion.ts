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
