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
type Sort = keyof typeof help.scaling.sorts;

export default function ScalingTable() {
  const { data } = useCalc();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("area");
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
    const at70 = (x: (typeof r)[number]) => x.vals[2]! - 70;
    if (sort === "up") r.sort((a, b) => at70(b) - at70(a));
    else if (sort === "down") r.sort((a, b) => at70(a) - at70(b));
    else if (sort === "name") r.sort((a, b) => a.c.name.localeCompare(b.c.name));
    return r;
  }, [data.subjects, q, sort, k]);

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-3">
        <label className="field min-w-[220px]">{k.search}
          <input className="input" type="search" placeholder={k.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="field min-w-[220px]">{k.sort}
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {(Object.keys(k.sorts) as Sort[]).map((s) => <option key={s} value={s}>{k.sorts[s]}</option>)}
          </select>
        </label>
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
                if (sort === "area" && (i === 0 || rows[i - 1]!.c.area !== r.c.area)) { out.push(<tr key={`a-${r.c.area}`} className="area"><td colSpan={9}>{r.c.area}</td></tr>); }
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
