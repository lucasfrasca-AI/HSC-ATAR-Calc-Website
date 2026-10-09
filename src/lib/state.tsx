// Single source of truth for the calculator. Every change goes through
// `update`, which clones, mutates the clone and re-derives everything — the
// React equivalent of the reference's refresh()/rebuild().
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

  const update = useCallback((fn: (d: Data) => void): Data => {
    const next = structuredClone(dataRef.current);
    fn(next);
    dataRef.current = next;
    setData(next);
    return next;
  }, []);
  const replace = useCallback((d: Data) => { dataRef.current = d; setData(d); }, []);

  const v: Validation = useMemo(() => validate(data), [data]);
  const c: Result = useMemo(() => compute(data), [data]);

  // ---- two-way graph binding ------------------------------------------------
  // The exam marks when a drag starts are the baseline, so moves never compound.
  const dragBase = useRef<Record<string, number> | null>(null);
  const [lastDrag, setLastDrag] = useState<LastDrag | null>(null);
  const beginDrag = useCallback(() => { dragBase.current = baseline(dataRef.current); }, []);
  const endDrag = useCallback(() => { dragBase.current = null; }, []);
  const driveTo = useCallback((targetAgg: number) => {
    const d = dataRef.current;
    if (!dragBase.current) dragBase.current = baseline(d);
    const base = dragBase.current;
    const ids = new Set(d.subjects.filter((s) => s.focus && base[s.uid] !== undefined).map((s) => s.uid));
    if (!ids.size) { setLastDrag(null); return; }
    const r = solveShift(d, base, ids, targetAgg);
    const next = update((n) => { for (const s of n.subjects) if (ids.has(s.uid)) s.exam = r.marks[s.uid]!; });
    setLastDrag({ ...r, sig: examSig(next) });
  }, [update]);
  const setAggregate = useCallback((agg: number) => { beginDrag(); driveTo(agg); endDrag(); }, [beginDrag, driveTo, endDrag]);

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
    const next = update((n) => { for (const s of n.subjects) if (base[s.uid] !== undefined) s[field] = r.marks[s.uid]!; });
    setGoal({ field, atar, shift: r, hadSet, sig: setSig(next) });
    return null;
  }, [update]);

  return {
    data, v, c, update, replace,
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
