import { test } from "node:test";
import assert from "node:assert/strict";
import sample from "../../content/sample-student.json" with { type: "json" };
import {
  blankData, compute, sanitise, solveShift, baseline, subjectFrom, validate, atarToAgg,
  type Data, type Subject,
} from "./engine.ts";

const data = (subjects: Subject[]): Data => ({ ...blankData(), subjects });
const keys = (d: Data, level?: string) => validate(d).issues.filter((i) => !level || i.level === level).map((i) => i.key);

test("golden: the sample student matches the reference calculator exactly", () => {
  const d = sanitise(sample);
  const c = compute(d);
  assert.equal(c.rawAggregate.toFixed(1), "366.0");
  assert.equal(c.aggregate.toFixed(1), "229.3");
  assert.equal(c.atar.toFixed(2), "64.39");
  assert.deepEqual(c.notCounted.map((n) => `${n.u.r.s.courseId}:${n.why}`), ["hms:best10"]);
  assert.equal(validate(d).eligible, true);
});

test("two subjects only: every eligibility rule fires (2025 rules)", () => {
  const d = data([subjectFrom("biology", { internalMark: 70 }), subjectFrom("chemistry", { internalMark: 70 })]);
  assert.deepEqual(validate(d).eligReasons.map((i) => i.key).sort(), ["elig.english0", "elig.subjects", "elig.twoUnit", "elig.units"]);
});

test("out-of-range entries are errors", () => {
  assert.ok(keys(data([subjectFrom("biology", { internalMark: 101 })]), "error").includes("subject.internalRange"));
  assert.ok(keys(data([subjectFrom("biology", { rank: 12, cohortSize: 10, internalMark: 70 })]), "error").includes("subject.rankOutside"));
  const tasks = (t: Partial<Subject["tasks"][number]>[]) =>
    subjectFrom("biology", { mode: "tasks", tasks: t.map((x) => ({ name: "", weight: null, raw: null, max: null, pct: null, rank: null, ...x })) });
  assert.ok(keys(data([tasks([{ weight: 50, raw: 31, max: 30 }])]), "error").includes("task.overTotal"));
  assert.ok(keys(data([tasks([{ weight: 60, pct: 70 }, { weight: 60, pct: 70 }])]), "error").includes("task.weightsOver"));
});

test("since 2025 there is no Category B cap: four VET units all count", () => {
  const d = data([
    subjectFrom("eng-std", { internalMark: 60 }), subjectFrom("vet-construction", { internalMark: 90 }),
    subjectFrom("vet-retail", { internalMark: 90 }), subjectFrom("biology", { internalMark: 50 }),
    subjectFrom("geography", { internalMark: 50 }),
  ]);
  const c = compute(d);
  assert.equal(c.counted.filter((u) => u.r.s.courseId.startsWith("vet-")).length, 4);
  assert.deepEqual(c.notCounted, []);
});

test("English Standard and English Advanced together is a mutually-exclusive error", () => {
  const d = data([subjectFrom("eng-std", { internalMark: 70 }), subjectFrom("eng-adv", { internalMark: 70 })]);
  assert.ok(keys(d, "error").includes("subject.exclusive"));
});

test("unreachable target with one ticked subject caps instead of silently clamping", () => {
  const d = sanitise(sample);
  const one = new Set([d.subjects[0]!.uid]);
  const r = solveShift(d, baseline(d), one, atarToAgg(99));
  assert.equal(r.capped, "max");
  assert.equal(r.marks[d.subjects[0]!.uid], 100);
  assert.ok(r.hi < atarToAgg(99));
});

test("tasks mode keeps the typed mark until a task has a mark and a weight", () => {
  const s = subjectFrom("biology", { internalMark: 68, mode: "tasks", tasks: [{ name: "", weight: 40, raw: null, max: null, pct: null, rank: null }] });
  const c = compute(data([s]));
  assert.equal(c.rows[0]!.used.mark, 68);
});

test("extension courses don't add a subject to the four-subject rule", () => {
  const d = data(["eng-adv", "eng-ext1", "maths-adv", "maths-ext1"].map((id) => subjectFrom(id, { internalMark: 70 })));
  assert.ok(validate(d).eligReasons.some((i) => i.key === "elig.subjects" && i.vars.n === 2));
});

test("Mathematics Extension 1 with Extension 2 flags the unit rule", () => {
  const d = data([subjectFrom("maths-ext1", { internalMark: 70 }), subjectFrom("maths-ext2", { internalMark: 70 })]);
  assert.ok(keys(d, "info").includes("subject.mathsExt1Units"));
});

test("sanitise rejects junk and bounds hostile input", () => {
  assert.throws(() => sanitise({}), /no-subjects/);
  assert.throws(() => sanitise(null), /no-subjects/);
  const d = sanitise({
    name: "<img src=x onerror=alert(1)>".repeat(10),
    settings: { level: "__proto__", spread: 999, moderation: "yes" },
    subjects: Array.from({ length: 50 }, () => ({ courseId: "constructor", internalMark: "70", anchors: [[1e9, "x"]], tasks: "nope" })),
  });
  assert.equal(d.name.length, 60);
  assert.equal(d.settings.level, "average");
  assert.equal(d.settings.spread, 10);
  assert.equal(d.subjects.length, 20);
  assert.equal(d.subjects[0]!.courseId, "custom");
  assert.equal(d.subjects[0]!.internalMark, 70);
  assert.deepEqual(d.subjects[0]!.anchors, [[1e9, null]]);
});
