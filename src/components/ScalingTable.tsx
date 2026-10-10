// Every course and its scaling. Loaded on demand (How it works tab) —
// check-budget fails the build if this lands on the critical path.
import { useMemo, useState } from "react";
import help from "../../content/help.json";
import site from "../../content/site.json";
import { CATALOG, TIERS } from "../lib/catalog.ts";
import { fmt, scaleMark } from "../lib/engine.ts";
import { useCalc } from "../lib/state.tsx";
import { t } from "../lib/text.ts";
import { Glass } from "./ui.tsx";

const POINTS = [50, 60, 70, 80, 90];

export default function ScalingTable() {
  const { data } = useCalc();
  const [q, setQ] = useState("");
  const k = help.scaling;
  const rows = useMemo(() => {
    let r = CATALOG.filter((c) => c.id !== "custom").map((c) => {
      const mine = data.subjects.find((s) => s.courseId === c.id);
      const mode = mine ? mine.scaling : c.anchors ? "course" : c.tier;
      const anchors = mine ? mine.anchors : (c.anchors ?? TIERS[c.tier].anchors);
      const est = mode !== "course" && mode !== "custom";
      const source = mode === "course" ? k.sourceSupplied : mode === "custom" ? k.sourceCustom
        : !mine && c.tierSource === "default" ? k.sourceDefault
        : t(k.sourceTier, { tier: TIERS[mode].label.replace(" scaling", "").toLowerCase() });
      return { c, mine: !!mine, est, source, vals: POINTS.map((p) => scaleMark(p, anchors)) };
    });
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => x.c.name.toLowerCase().includes(needle) || x.c.area.toLowerCase().includes(needle));
    // One fixed order: highest scaling first (at a mark of 70, then 90 to break ties, then name).
    // Courses with no course-specific scaling recorded (generic average) go last, in their own group.
    const noRecord = (x: (typeof r)[number]) => !x.mine && x.c.tierSource === "default";
    r.sort((a, b) => Number(noRecord(a)) - Number(noRecord(b)) || b.vals[2]! - a.vals[2]! || b.vals[4]! - a.vals[4]! || a.c.name.localeCompare(b.c.name));
    return r.map((x) => ({ ...x, noRecord: noRecord(x) }));
  }, [data.subjects, q, k]);

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-3">
        <label className="field min-w-[220px]">{k.search}
          <input className="input" type="search" placeholder={k.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <p className="self-end pb-2.5 text-[0.82rem] text-foreground-3">{k.order}</p>
      </div>
      <Glass className="glass-sm tscroll">
        {!rows.length ? <p className="p-4 text-foreground-2">{t(k.noMatch, { q })}</p> : (
          <table className="datatable min-w-[860px]">
            <thead><tr>
              <th scope="col">{k.cols.course}</th><th scope="col">{k.cols.code}</th><th scope="col">{k.cols.units}</th>
              <th scope="col" className="!text-left">{k.cols.source}</th>
              {POINTS.map((p) => <th key={p} scope="col">{t(k.cols.mark, { p })}</th>)}
            </tr></thead>
            <tbody>
              {rows.flatMap((r, i) => {
                const out = [];
                if (r.noRecord && (i === 0 || !rows[i - 1]!.noRecord)) out.push(<tr key="no-record" className="area"><td colSpan={9}>{k.noRecord}</td></tr>);
                out.push(
                  <tr key={r.c.id}>
                    <td>{r.c.name}{r.mine && <span className="pill ml-2">{k.mine}</span>}</td>
                    <td className="text-foreground-3">{r.c.nesaCode ?? site.labels.dash}</td>
                    <td>{r.c.units}</td>
                    <td className="!text-left">{r.source}{r.est && <span className="flag">{site.labels.estimate}</span>}</td>
                    {r.vals.map((v, i) => { const d = v - POINTS[i]!; return (
                      <td key={i}>{fmt(v)}<small className={`ml-1 text-[0.74rem] ${d < 0 ? "text-loss" : "text-gain"}`}>{d >= 0 ? "+" : "−"}{fmt(Math.abs(d))}</small></td>
                    ); })}
                  </tr>,
                );
                return out;
              })}
            </tbody>
          </table>
        )}
      </Glass>
      <p className="mt-2 text-[0.78rem] text-foreground-3">{k.note}</p>
    </>
  );
}
