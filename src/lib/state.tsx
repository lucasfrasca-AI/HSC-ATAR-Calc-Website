// Single source of truth for the calculator. Every change goes through
// `update`, which clones, mutates the clone and re-derives everything — the
// React equivalent of the reference's refresh()/rebuild().
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import sample from "../../content/sample-student.json" with { type: "json" };
import {
  atarToAgg, baseline, blankData, compute, inRange, sanitise, solveShift, validate,
  type Data, type Result, type Shift, type Validation,
} from "./engine.ts";
import { STORE_KEY, read, write } from "./storage.ts";

export type GoalField = "expected" | "target";
export interface GoalMsg { field: GoalField; atar: number; shift: Shift; hadSet: boolean; sig: string }
interface LastDrag extends Shift { sig: string }

const examSig = (d: Data) => d.subjects.map((s) => s.exam).join("|");
const setSig = (d: Data) => d.subjects.map((s) => `${s.expected},${s.target}`).join("|");

// The input element whose keystroke/slide is being applied right now, set by
// typing() around a change handler. Only these changes may merge into one undo step.
let typingSource: Element | null = null;
/** Wrap an input's change handler: keystrokes in the same field within a short gap become one undo step. */
export function typing(el: Element, apply: () => void) {
  typingSource = el;
  try { apply(); } finally { typingSource = null; }
}

function load(): Data {
  const raw = read(STORE_KEY);
  if (!raw) return blankData();
  try { return sanitise(JSON.parse(raw)); } catch { return blankData(); }
}
export const sampleData = () => sanitise(sample);

function useCalculatorState() {
  const [data, setData] = useState<Data>(load);
  // Latest data, written synchronously by update/replace so handlers that fire
  // several times per frame (pointer drags) never read a stale value.
  const dataRef = useRef(data);
  useEffect(() => write(STORE_KEY, JSON.stringify(data)), [data]);

  // ---- undo / redo ----------------------------------------------------------
  // Only *continuous* input merges into one undo step: keystrokes in the same
  // focused text/number/range field, or the frames of one drag, within GAP ms.
  // Buttons, checkboxes, menus and whole-document changes are always their own step.
  const GAP = 700, LIMIT = 60;
  const past = useRef<Data[]>([]), future = useRef<Data[]>([]), lastChange = useRef(0);
  const lastSource = useRef<Element | "drag" | null>(null);
  const dragging = useRef(false);
  const [hist, setHist] = useState({ undo: 0, redo: 0 });
  const syncHist = () => setHist({ undo: past.current.length, redo: future.current.length });
  const commit = useCallback((next: Data, discrete: boolean) => {
    const now = performance.now();
    // A drag is one continuous source; otherwise only a change made inside typing() for the same field.
    const src: Element | "drag" | null = dragging.current ? "drag" : typingSource;
    const continuous = !discrete && src !== null && src === lastSource.current && now - lastChange.current <= GAP;
    if (!continuous) {
      past.current.push(dataRef.current);
      if (past.current.length > LIMIT) past.current.shift();
    }
    lastSource.current = src;
    lastChange.current = now;
    future.current = [];
    dataRef.current = next;
    setData(next);
    syncHist();
  }, []);

  const update = useCallback((fn: (d: Data) => void, opts?: { discrete?: boolean }): Data => {
    const next = structuredClone(dataRef.current);
    fn(next);
    commit(next, !!opts?.discrete);
    return next;
  }, [commit]);
  /** Whole-document changes (import, test data, start fresh) are always their own undo step. */
  const replace = useCallback((d: Data) => commit(d, true), [commit]);
  const travel = useCallback((from: React.RefObject<Data[]>, to: React.RefObject<Data[]>) => {
    const prev = from.current.pop();
    if (!prev) return false;
    to.current.push(dataRef.current);
    dataRef.current = prev;
    lastChange.current = 0;
    setData(prev);
    syncHist();
    return true;
  }, []);
  const undo = useCallback(() => travel(past, future), [travel]);
  const redo = useCallback(() => travel(future, past), [travel]);

  const v: Validation = useMemo(() => validate(data), [data]);
  const c: Result = useMemo(() => compute(data), [data]);

  // ---- two-way graph binding ------------------------------------------------
  // The exam marks when a drag starts are the baseline, so moves never compound.
  const dragBase = useRef<Record<string, number> | null>(null);
  const [lastDrag, setLastDrag] = useState<LastDrag | null>(null);
  // Each drag (or keyboard/typed pin move) is exactly one undo step.
  const beginDrag = useCallback(() => { dragBase.current = baseline(dataRef.current); dragging.current = true; lastChange.current = 0; }, []);
  const endDrag = useCallback(() => { dragBase.current = null; dragging.current = false; lastChange.current = 0; }, []);
  /** Returns the solve (incl. the reachable aggregate range lo..hi), or null if no subject is ticked. */
  const driveTo = useCallback((targetAgg: number): Shift | null => {
    const d = dataRef.current;
    if (!dragBase.current) dragBase.current = baseline(d);
    const base = dragBase.current;
    const ids = new Set(d.subjects.filter((s) => s.focus && base[s.uid] !== undefined).map((s) => s.uid));
    if (!ids.size) { setLastDrag(null); return null; }
    const r = solveShift(d, base, ids, targetAgg);
    const next = update((n) => { for (const s of n.subjects) if (ids.has(s.uid)) s.exam = r.marks[s.uid]!; });
    setLastDrag({ ...r, sig: examSig(next) });
    return r;
  }, [update]);
  const setAggregate = useCallback((agg: number) => { beginDrag(); driveTo(agg); endDrag(); lastChange.current = 0; }, [beginDrag, driveTo, endDrag]);

  // ---- expected / target sets from a typed ATAR ---------------------------
  const [goal, setGoal] = useState<GoalMsg | null>(null);
  /** Returns a toast key when nothing can be done. */
  const goalSet = useCallback((field: GoalField, atar: number): "needInternal" | "tickOne" | null => {
    const d = dataRef.current;
    const base = baseline(d, field);
    const valid = d.subjects.filter((s) => base[s.uid] !== undefined);
    if (!valid.length) return "needInternal";
    const ids = new Set(valid.filter((s) => s.focus).map((s) => s.uid));
    if (!ids.size) return "tickOne";
    const hadSet = valid.some((s) => inRange(s[field], 0, 100) !== null);
    const r = solveShift(d, base, ids, atarToAgg(atar));
    const next = update((n) => { for (const s of n.subjects) if (base[s.uid] !== undefined) s[field] = r.marks[s.uid]!; }, { discrete: true });
    setGoal({ field, atar, shift: r, hadSet, sig: setSig(next) });
    return null;
  }, [update]);

  return {
    data, v, c, update, replace,
    undo, redo, canUndo: hist.undo > 0, canRedo: hist.redo > 0,
    beginDrag, endDrag, driveTo, setAggregate,
    lastDrag: lastDrag && lastDrag.sig === examSig(data) ? lastDrag : null,
    clearDrag: () => setLastDrag(null),
    goal: goal && goal.sig === setSig(data) ? goal : null,
    clearGoal: () => setGoal(null),
    goalSet,
  };
}

export type Calc = ReturnType<typeof useCalculatorState>;
const Ctx = createContext<Calc | null>(null);
export function CalculatorProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useCalculatorState()}>{children}</Ctx.Provider>;
}
export const useCalc = () => useContext(Ctx)!;
