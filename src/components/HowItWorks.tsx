import { Suspense, lazy } from "react";
import help from "../../content/help.json";
import { fmt } from "../lib/engine.ts";
import { useCalc } from "../lib/state.tsx";
import { t } from "../lib/text.ts";
import { Glass, Section } from "./ui.tsx";

const ScalingTable = lazy(() => import("./ScalingTable.tsx"));

export function HowItWorks() {
  const { c } = useCalc();
  const e = help.explainer;
  const quote = c.counted.length ? t(e.quoteLive, { agg: fmt(c.aggregate), pct: fmt(c.aggregate / 5), atar: fmt(c.atar, 1) }) : e.quoteDefault;
  return (
    <>
      <Section>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Glass className="p-5 sm:p-6">
            <h2 className="text-[1.15rem] font-semibold">{e.title}</h2>
            <p className="mt-2.5 text-[0.92rem] text-foreground-2">{e.p1}</p>
            <blockquote className="my-4 border-l-[3px] border-accent pl-3.5 text-[1.18rem] leading-snug font-medium tracking-[-0.01em]">{quote}</blockquote>
            <p className="text-[0.92rem] text-foreground-2">{e.p2Lead}<strong className="text-foreground">{e.p2Strong}</strong>{e.p2Rest}</p>
          </Glass>
          <Glass className="p-5 sm:p-6">
            <h2 className="text-[1.15rem] font-semibold">{help.trust.title}</h2>
            {help.trust.notes.map((n) => (
              <details key={n.title} open={n.open} className="border-t border-border/10 py-3 first-of-type:mt-2">
                <summary className="flex justify-between text-[0.9rem] font-semibold">{n.title} <span className="plus" aria-hidden="true">+</span></summary>
                <p className="pt-2.5 text-[0.88rem] text-foreground-2">{n.body}</p>
              </details>
            ))}
          </Glass>
        </div>
      </Section>
      <Section id="scaleRef" title={help.scaling.title} intro={help.scaling.intro}>
        <Suspense fallback={<p className="text-foreground-3" role="status">{help.scaling.loading}</p>}>
          <ScalingTable />
        </Suspense>
      </Section>
    </>
  );
}
