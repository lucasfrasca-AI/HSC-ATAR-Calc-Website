// The ATAR model. Pure functions over a Data value — no DOM, no React, no copy.
// Ported from reference/nsw-hsc-atar-calculator-blank.html §3–§7. Issues are
// returned as message keys + variables; the UI renders them from content/.
//
// Calculation chain:
//   task marks ─┐
//               ├─► internal ─► (optional moderation by rank) ─┐
//   final mark ─┘                                              ├─► blended = (internal + exam) / 2
//   exam mark ─────────────────────────────────────────────────┘
//      └─► scaleMark(blended, anchors) → /100 → ÷2 per unit
//          └─► best 2 English units + best 8 others → aggregate /500 → ATAR
import {
  ATAR_ANCHORS, COHORT_LEVELS, RULES, TIERS, courseById, isLevel, isTier,
  type Anchor, type LevelKey, type TierKey,
} from "./catalog.ts";

export interface Task { name: string; weight: number | null; raw: number | null; max: number | null; pct: number | null; rank: number | null }
export type Scaling = TierKey | "course" | "custom";
export interface Subject {
  uid: string;
  courseId: string;
  name: string;
  units: 1 | 2;
  english: boolean;
  extension: boolean;
  excl: string | null;
  scaling: Scaling;
  anchors: Anchor[];
  mode: "simple" | "tasks";
  internalMark: number | null;
  rank: number | null;
  cohortSize: number | null;
  cohortMean: number | null;
  tasks: Task[];
  exam: number | null;
  expected: number | null;
  target: number | null;
  focus: boolean;
}
export interface Settings { moderation: boolean; level: LevelKey; spread: number }
export interface Data { name: string; settings: Settings; subjects: Subject[] }
export type MarkField = "exam" | "expected" | "target";

export type Level = "error" | "warn" | "info";
export interface Issue { level: Level; key: string; vars: Record<string, string | number>; uid?: string }

/* ---------- small helpers ---------- */
export const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
export const inRange = (v: unknown, lo: number, hi: number): number | null => {
  const n = num(v);
  return n === null || n < lo || n > hi ? null : n;
};
export const fmt = (n: number | null | undefined, d = 1): string =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : Number(n).toFixed(d);
export const clamp100 = (v: number) => Math.max(0, Math.min(100, v));
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

let uidSeq = 1;
export const blankTask = (): Task => ({ name: "", weight: null, raw: null, max: null, pct: null, rank: null });
export const blankData = (): Data => ({ name: "", settings: { moderation: false, level: "average", spread: 10 }, subjects: [] });

export function subjectFrom(courseId: string, o: Partial<Subject> = {}): Subject {
  const c = courseById(courseId);
  const s: Subject = {
    uid: "s" + uidSeq++,
    courseId: c.id,
    name: c.id === "custom" ? "" : c.name,
    units: c.units, english: c.english, extension: c.extension, excl: c.excl,
    scaling: c.anchors ? "course" : c.tier,
    anchors: clone(c.anchors ?? TIERS[c.tier].anchors),
    mode: "simple",
    internalMark: null, rank: null, cohortSize: null, cohortMean: null,
    tasks: [], exam: null, expected: null, target: null, focus: true,
  };
  return Object.assign(s, o);
}

export const displayName = (s: Subject) => s.name || courseById(s.courseId).name;
export const isEstimate = (s: Subject) => s.scaling !== "course" && s.scaling !== "custom";
export const bandOf = (m: number) => (m >= 90 ? 6 : m >= 80 ? 5 : m >= 70 ? 4 : m >= 60 ? 3 : m >= 50 ? 2 : 1);

/* ---------- internal marks ---------- */
export function taskMark(t: Task): number | null {
  const raw = num(t.raw), max = num(t.max);
  if (raw !== null && max !== null && max > 0 && raw >= 0 && raw <= max) return (raw / max) * 100;
  return inRange(t.pct, 0, 100);
}

export interface InternalInfo { mark: number | null; rank: number | null; cohort: number | null; weightSum: number | null; fromTasks: boolean; rankFromTasks: boolean }
/** Falls back to the typed internal mark in tasks mode until a task has both a mark and a weight. */
export function internalInfo(s: Subject): InternalInfo {
  const cohort = inRange(s.cohortSize, 1, 5000);
  let mark: number | null, rank = inRange(s.rank, 1, 5000), weightSum: number | null = null;
  let fromTasks = false, rankFromTasks = false;
  if (s.mode === "tasks" && s.tasks.length) {
    let ws = 0, acc = 0, rw = 0, racc = 0;
    for (const t of s.tasks) {
      const m = taskMark(t), w = inRange(t.weight, 0, 100);
      if (m !== null && w !== null && w > 0) { ws += w; acc += m * w; }
      const r = inRange(t.rank, 1, 5000);
      if (r !== null && w) { rw += w; racc += r * w; }
    }
    weightSum = s.tasks.reduce((a, t) => a + (inRange(t.weight, 0, 100) ?? 0), 0);
    if (ws > 0) { mark = acc / ws; fromTasks = true; } else mark = inRange(s.internalMark, 0, 100);
    if (rank === null && rw > 0) { rank = racc / rw; rankFromTasks = true; }
  } else {
    mark = inRange(s.internalMark, 0, 100);
  }
  if (rank !== null && cohort !== null && rank > cohort) rank = null;
  return { mark, rank, cohort, weightSum, fromTasks, rankFromTasks };
}

/** Moderation estimate: place the rank on an assumed cohort exam distribution. Opt-in. */
export function usedInternal(st: Settings, s: Subject, info: InternalInfo): { mark: number | null; moderated: boolean } {
  if (st.moderation && info.mark !== null && info.rank !== null && info.cohort !== null) {
    const mean = inRange(s.cohortMean, 0, 100) ?? COHORT_LEVELS[st.level].mean;
    const p = Math.min(0.995, Math.max(0.005, 1 - (info.rank - 0.5) / info.cohort));
    return { mark: clamp100(mean + normInv(p) * (num(st.spread) || 10)), moderated: true };
  }
  return { mark: info.mark, moderated: false };
}

/* ---------- maths ---------- */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}
const A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
export function normInv(p: number): number {
  const [a0, a1, a2, a3, a4, a5] = A as [number, number, number, number, number, number];
  const [b0, b1, b2, b3, b4] = B as [number, number, number, number, number];
  const [c0, c1, c2, c3, c4, c5] = C as [number, number, number, number, number, number];
  const [d0, d1, d2, d3] = D as [number, number, number, number];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) / ((((d0 * q + d1) * q + d2) * q + d3) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) / ((((d0 * q + d1) * q + d2) * q + d3) * q + 1); }
  const q = p - 0.5, r = q * q;
  return ((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) / (((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1);
}

/** Normal fit through the two UAC reference points in content/scaling.json. */
export const FIT = (() => {
  const [p1, p2] = ATAR_ANCHORS as [{ aggregate: number; atar: number }, { aggregate: number; atar: number }];
  const z1 = normInv(p1.atar / 100), z2 = normInv(p2.atar / 100);
  const sd = (p2.aggregate - p1.aggregate) / (z2 - z1);
  return { mean: p1.aggregate - z1 * sd, sd };
})();
export const MAX_AGGREGATE = RULES.maxAggregate;
export const COUNTING_UNITS = RULES.countingUnits;
export const aggregateToAtar = (agg: number) => Math.min(99.95, Math.max(0, normCdf((agg - FIT.mean) / FIT.sd) * 100));
export const atarToAgg = (a: number) =>
  Math.max(0, Math.min(MAX_AGGREGATE, FIT.mean + normInv(Math.min(99.95, Math.max(0.05, a)) / 100) * FIT.sd));
export const density = (x: number) => { const z = (x - FIT.mean) / FIT.sd; return Math.exp((-z * z) / 2); };

export function cleanAnchors(anchors: Anchor[]): [number, number][] {
  return anchors
    .map((a) => [num(a[0]), num(a[1])] as const)
    .filter((a): a is readonly [number, number] => a[0] !== null && a[1] !== null && a[0] > 0 && a[0] <= 100 && a[1] >= 0 && a[1] <= 100)
    .map((a) => [a[0], a[1]] as [number, number])
    .sort((x, y) => x[0] - y[0]);
}
/** Piecewise-linear blended → scaled (both /100). Below the first anchor: proportional; above the last: linear to (100,100). */
export function scaleMark(raw: number, anchorsIn: Anchor[]): number {
  const a = cleanAnchors(anchorsIn);
  if (!a.length) return raw;
  const first = a[0]!, last = a[a.length - 1]!;
  if (raw <= first[0]) return (raw / first[0]) * first[1];
  if (raw >= last[0]) return last[0] >= 100 ? last[1] : last[1] + ((raw - last[0]) / (100 - last[0])) * (100 - last[1]);
  for (let i = 0; i < a.length - 1; i++) {
    const [x0, y0] = a[i]!, [x1, y1] = a[i + 1]!;
    if (raw >= x0 && raw <= x1) return x1 === x0 ? y1 : y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0);
  }
  return raw;
}

/* ---------- validation ---------- */
export interface Validation { issues: Issue[]; eligible: boolean; eligReasons: Issue[]; totalUnits: number }

export function validate(data: Data): Validation {
  const issues: Issue[] = [];
  const push = (level: Level, key: string, vars: Issue["vars"] = {}, uid?: string) => issues.push({ level, key, vars, uid });
  const subj = data.subjects;

  for (const s of subj) {
    const name = displayName(s);
    const info = internalInfo(s);
    if (s.courseId === "custom" && !s.name.trim()) push("warn", "subject.customName", {}, s.uid);
    const typed = s.internalMark === null ? null : num(s.internalMark);
    if (typed !== null && inRange(typed, 0, 100) === null) push("error", "subject.internalRange", { name }, s.uid);
    if (s.mode === "tasks") {
      s.tasks.forEach((t, i) => {
        const task = t.name ? `“${t.name}”` : `task ${i + 1}`;
        const raw = num(t.raw), max = num(t.max), w = num(t.weight), m = taskMark(t);
        if (raw === null && max === null && num(t.pct) === null && w === null) return;
        if (raw !== null && max !== null && raw > max) push("error", "task.overTotal", { name, task, raw, max }, s.uid);
        if (max !== null && max <= 0) push("error", "task.totalZero", { name, task }, s.uid);
        if (raw !== null && raw < 0) push("error", "task.negative", { name, task }, s.uid);
        if (raw !== null && max === null) push("warn", "task.needsTotal", { name, task }, s.uid);
        if (m !== null && (w === null || w <= 0 || w > 100)) push("error", "task.needsWeight", { name, task }, s.uid);
        if (m === null && w !== null && !(raw !== null && max === null)) push("info", "task.weightNoMark", { name, task }, s.uid);
      });
      const ws = info.weightSum ?? 0;
      if (ws > 100.05) push("error", "task.weightsOver", { name, sum: fmt(ws) }, s.uid);
      else if (info.fromTasks && ws < 99.95) push("info", "task.weightsPartial", { name, sum: fmt(ws) }, s.uid);
      if (!info.fromTasks) {
        if (info.mark !== null) push("info", "task.usingFinal", { name }, s.uid);
        else push("error", "task.needInternal", { name }, s.uid);
      }
    } else if (typed === null) push("error", "subject.needInternal", { name }, s.uid);
    const r = num(s.rank), n = num(s.cohortSize);
    if (r !== null && (r < 1 || !Number.isInteger(r))) push("error", "subject.rankWhole", { name }, s.uid);
    if (n !== null && (n < 1 || !Number.isInteger(n))) push("error", "subject.cohortWhole", { name }, s.uid);
    if (r !== null && n !== null && r > n) push("error", "subject.rankOutside", { name, rank: r, cohort: n }, s.uid);
    if (data.settings.moderation && (info.rank === null || info.cohort === null)) push("info", "subject.noModeration", { name }, s.uid);
    if (cleanAnchors(s.anchors).length < 2) push("warn", "subject.fewAnchors", { name }, s.uid);
    for (const [k, label] of [["exam", "what-if"], ["expected", "expected"], ["target", "target"]] as const) {
      const x = num(s[k]);
      if (x !== null && (x < 0 || x > 100)) push("error", "subject.examRange", { name, label }, s.uid);
    }
  }

  // duplicates + mutually exclusive courses
  const seen = new Set<string>();
  for (const s of subj) {
    if (s.courseId === "custom") continue;
    if (seen.has(s.courseId)) push("error", "subject.duplicate", { name: displayName(s) }, s.uid);
    seen.add(s.courseId);
  }
  const excl = new Map<string, Subject[]>();
  for (const s of subj) if (s.excl) excl.set(s.excl, [...(excl.get(s.excl) ?? []), s]);
  for (const g of excl.values()) {
    const names = [...new Set(g.map(displayName))];
    if (names.length > 1) push("error", "subject.exclusive", { names: names.join(" and ") }, g[1]!.uid);
  }
  // UAC footnote: Mathematics Extension 1's unit value depends on Extension 2.
  const ext1 = subj.find((s) => s.courseId === "maths-ext1");
  if (ext1 && ext1.units === 1 && subj.some((s) => s.courseId === "maths-ext2")) push("info", "subject.mathsExt1Units", {}, ext1.uid);

  // eligibility (2025 rules: categorisation removed) on subjects with a usable mark
  const usable = subj.filter((s) => internalInfo(s).mark !== null);
  const totalUnits = usable.reduce((a, s) => a + s.units, 0);
  const engUnits = usable.filter((s) => s.english).reduce((a, s) => a + s.units, 0);
  const twoPlus = usable.filter((s) => s.units >= 2).length;
  // Extension courses sit within their parent subject, so they never add a subject.
  const subjects = new Set(usable.filter((s) => !s.extension).map((s) => (s.courseId === "custom" ? s.uid : s.courseId))).size;

  const elig: Issue[] = [];
  const e = (key: string, vars: Issue["vars"] = {}) => elig.push({ level: "error", key, vars });
  if (!subj.length) e("elig.addSubjects");
  else {
    if (totalUnits < RULES.minUnits) e(totalUnits === 1 ? "elig.units1" : "elig.units", { n: totalUnits, min: RULES.minUnits });
    if (engUnits < RULES.minEnglishUnits) e(engUnits === 0 ? "elig.english0" : "elig.english1");
    if (twoPlus < RULES.minTwoUnitCourses) e(twoPlus === 1 ? "elig.twoUnit1" : "elig.twoUnit", { n: twoPlus, min: RULES.minTwoUnitCourses });
    if (subjects < RULES.minSubjects) e(subjects === 1 ? "elig.subjects1" : "elig.subjects", { n: subjects, min: RULES.minSubjects });
  }
  if (totalUnits > 12) push("info", "elig.manyUnits", { n: totalUnits });
  issues.push(...elig);
  return { issues, eligible: elig.length === 0 && !issues.some((i) => i.level === "error"), eligReasons: elig, totalUnits };
}

/* ---------- aggregate ---------- */
export interface Row {
  s: Subject; info: InternalInfo; used: { mark: number | null; moderated: boolean }; valid: boolean;
  external: number; blended: number; scaled100: number; unitValue: number; rawUnit: number; rawIntUnit: number; rawExamUnit: number;
}
export interface Unit { r: Row; value: number; english: boolean }
export interface Result {
  rows: Row[]; counted: Unit[]; notCounted: { u: Unit; why: "best10" }[]; countedBy: Record<string, number>;
  aggregate: number; rawAggregate: number; rawInternal: number; rawExam: number; atar: number;
}
export type ExamFor = (s: Subject, internal: number) => number;

export function computeFrom(data: Data, examFor: ExamFor): Result {
  const rows: Row[] = data.subjects.map((s) => {
    const info = internalInfo(s);
    const used = usedInternal(data.settings, s, info);
    if (used.mark === null) return { s, info, used, valid: false, external: 0, blended: 0, scaled100: 0, unitValue: 0, rawUnit: 0, rawIntUnit: 0, rawExamUnit: 0 };
    const external = examFor(s, used.mark);
    const blended = (used.mark + external) / 2;
    const scaled100 = scaleMark(blended, s.anchors);
    return { s, info, used, valid: true, external, blended, scaled100, unitValue: scaled100 / 2, rawUnit: blended / 2, rawIntUnit: used.mark / 4, rawExamUnit: external / 4 };
  });

  const units: Unit[] = [];
  for (const r of rows) if (r.valid) for (let i = 0; i < r.s.units; i++) units.push({ r, value: r.unitValue, english: r.s.english });
  const desc = (a: Unit, b: Unit) => b.value - a.value;
  const counted = units.filter((u) => u.english).sort(desc).slice(0, 2);
  const notCounted: Result["notCounted"] = [];
  for (const u of units.filter((u) => !counted.includes(u)).sort(desc)) {
    if (counted.length >= COUNTING_UNITS) notCounted.push({ u, why: "best10" });
    else counted.push(u);
  }
  const sum = (f: (u: Unit) => number) => counted.reduce((a, u) => a + f(u), 0);
  const aggregate = sum((u) => u.value);
  const countedBy: Record<string, number> = {};
  for (const u of counted) countedBy[u.r.s.uid] = (countedBy[u.r.s.uid] ?? 0) + 1;
  return {
    rows, counted, notCounted, countedBy, aggregate,
    rawAggregate: sum((u) => u.r.rawUnit), rawInternal: sum((u) => u.r.rawIntUnit), rawExam: sum((u) => u.r.rawExamUnit),
    atar: aggregateToAtar(aggregate),
  };
}
/** The what-if exam mark: as set, or the internal mark until one is set. */
export const examOf: ExamFor = (s, internal) => { const e = inRange(s.exam, 0, 100); return e === null ? Math.round(internal) : e; };
export const compute = (data: Data) => computeFrom(data, examOf);

export function scenarioAgg(data: Data, field: "expected" | "target") {
  const valid = data.subjects.filter((s) => internalInfo(s).mark !== null);
  if (!valid.some((s) => inRange(s[field], 0, 100) !== null)) return null;
  const c = computeFrom(data, (s, i) => inRange(s[field], 0, 100) ?? examOf(s, i));
  return { agg: c.aggregate, atar: c.atar, partial: valid.some((s) => inRange(s[field], 0, 100) === null) };
}

/** Exam marks of every subject with a usable internal mark, as a drag/solve baseline. */
export function baseline(data: Data, field?: "expected" | "target"): Record<string, number> {
  const base: Record<string, number> = {};
  for (const s of data.subjects) {
    const i = usedInternal(data.settings, s, internalInfo(s)).mark;
    if (i === null) continue;
    base[s.uid] = field ? (inRange(s[field], 0, 100) ?? examOf(s, i)) : examOf(s, i);
  }
  return base;
}

export interface Shift { marks: Record<string, number>; delta: number; clipped: boolean; hi: number; lo: number; n: number; capped: "max" | "min" | null }
/** Binary-search one mark delta applied to every subject in `ids` until the aggregate hits the target. */
export function solveShift(data: Data, base: Record<string, number>, ids: Set<string>, targetAgg: number): Shift {
  const at = (d: number) => computeFrom(data, (s) => (ids.has(s.uid) ? clamp100(base[s.uid]! + d) : base[s.uid]!)).aggregate;
  const lo = at(-100), hi = at(100);
  let d: number;
  if (targetAgg >= hi) d = 100;
  else if (targetAgg <= lo) d = -100;
  else {
    let a = -100, b = 100;
    for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (at(m) < targetAgg) a = m; else b = m; }
    d = (a + b) / 2;
  }
  const marks: Record<string, number> = {};
  let moved = 0, clipped = false;
  for (const uid of Object.keys(base)) {
    if (ids.has(uid)) {
      const want = base[uid]! + d, v = Math.round(clamp100(want) * 10) / 10;
      if (want > 100 || want < 0) clipped = true;
      marks[uid] = v; moved += v - base[uid]!;
    } else marks[uid] = base[uid]!;
  }
  return { marks, delta: moved / ids.size, clipped, hi, lo, n: ids.size, capped: targetAgg > hi + 0.05 ? "max" : targetAgg < lo - 0.05 ? "min" : null };
}

/* ---------- persistence ---------- */
/** Accepts untrusted JSON (localStorage, imported files) and returns a clean Data. Throws on no subjects array. */
export function sanitise(d: unknown): Data {
  const x = d as Record<string, unknown> | null;
  if (!x || !Array.isArray(x.subjects)) throw new Error("no-subjects");
  const st = (x.settings ?? {}) as Record<string, unknown>;
  const out: Data = {
    name: String(x.name ?? "").slice(0, 60),
    settings: { moderation: !!st.moderation, level: isLevel(st.level) ? st.level : "average", spread: inRange(st.spread, 3, 25) ?? 10 },
    subjects: [],
  };
  for (const raw of (x.subjects as unknown[]).slice(0, RULES.maxSubjects)) {
    const y = (raw ?? {}) as Record<string, unknown>;
    const id = typeof y.courseId === "string" && courseById(y.courseId).id === y.courseId ? y.courseId : "custom";
    const s = subjectFrom(id);
    if (typeof y.name === "string" && (id === "custom" || y.name)) s.name = y.name.slice(0, 60);
    for (const k of ["internalMark", "rank", "cohortSize", "cohortMean", "exam", "expected", "target"] as const) s[k] = num(y[k]);
    s.focus = y.focus !== false;
    if (y.units === 1 || y.units === 2) s.units = y.units;
    if (typeof y.english === "boolean") s.english = y.english;
    // "course" anchors exist only for catalogue courses that ship them; otherwise keep the default tier.
    if ((y.scaling === "course" && courseById(id).anchors) || y.scaling === "custom" || isTier(y.scaling)) s.scaling = y.scaling;
    if (Array.isArray(y.anchors)) s.anchors = y.anchors.slice(0, 8).map((a: unknown) => { const p = Array.isArray(a) ? a : []; return [num(p[0]), num(p[1])] as Anchor; });
    s.mode = y.mode === "tasks" ? "tasks" : "simple";
    if (Array.isArray(y.tasks))
      s.tasks = y.tasks.slice(0, 20).map((t: unknown) => {
        const z = (t ?? {}) as Record<string, unknown>;
        return { name: String(z.name ?? "").slice(0, 80), weight: num(z.weight), raw: num(z.raw), max: num(z.max), pct: num(z.pct), rank: num(z.rank) };
      });
    out.subjects.push(s);
  }
  return out;
}
