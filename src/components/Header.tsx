import { useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import site from "../../content/site.json";
import mark from "../assets/lf-mark.png";
import { fmt, sanitise } from "../lib/engine.ts";
import { useReducedMotion, useTween } from "../lib/motion.ts";
import { useCalc } from "../lib/state.tsx";
import { t } from "../lib/text.ts";
import { THEMES, currentTheme, setTheme, type ThemeId } from "../lib/theme.ts";
import { useFeedback } from "./Feedback.tsx";
import { Glass, Stat } from "./ui.tsx";

function ThemePicker() {
  const [theme, set] = useState<ThemeId>(currentTheme);
  const name = THEMES.find((x) => x.id === theme)?.name;
  return (
    <details className="relative">
      <summary className="btn" aria-label={`${site.theme.label}: ${name}`}>
        <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-accent-fill" />
        {name}
      </summary>
      <Glass as="fieldset" className="glass-sm absolute right-0 z-20 mt-2 w-52 p-2">
        <legend className="sr-only">{site.theme.label}</legend>
        {THEMES.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-foreground/5">
            <input type="radio" name="theme" value={o.id} checked={theme === o.id} onChange={() => { setTheme(o.id); set(o.id); }} />
            <span data-theme-swatch={o.id}>{o.name}</span>
          </label>
        ))}
      </Glass>
    </details>
  );
}

function Toolbar() {
  const { data, replace } = useCalc();
  const { toast } = useFeedback();
  const file = useRef<HTMLInputElement>(null);
  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `hsc-atar-${(data.name || "student").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
    });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(site.toasts.exported);
  };
  const importData = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try {
      const d = sanitise(JSON.parse(await f.text()));
      replace(d);
      toast(t(site.toasts.imported, { n: d.subjects.length }));
    } catch (err) {
      const reason = err instanceof Error && err.message === "no-subjects" ? site.toasts.importNoSubjects : site.toasts.importBadJson;
      toast(t(site.toasts.importFailed, { reason }));
    }
  };
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <ThemePicker />
      <button type="button" className="btn" onClick={exportData}>{site.toolbar.export}</button>
      <button type="button" className="btn" onClick={() => file.current?.click()}>{site.toolbar.import}</button>
      <input ref={file} type="file" accept="application/json,.json" hidden aria-label={site.toolbar.importLabel} onChange={importData} />
      <button type="button" className="btn" onClick={() => window.print()}>{site.toolbar.print}</button>
    </div>
  );
}

function Readout() {
  const { data, v, c } = useCalc();
  const reduced = useReducedMotion();
  const has = data.subjects.length > 0 && c.counted.length > 0;
  const atar = useTween(has ? c.atar : 0);
  const raf = useRef(0);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const el = e.currentTarget, r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => { el.style.setProperty("--mx", `${x}px`); el.style.setProperty("--my", `${y}px`); });
  };
  const cap = !data.subjects.length ? site.readout.capEmpty : !v.eligible ? site.readout.capIndicative : site.readout.capOk;
  return (
    <Glass
      className="glass-refract glass-spec mt-6 grid gap-6 p-5 sm:p-7 md:grid-cols-[auto_1fr] md:items-end"
      onPointerEnter={(e: PointerEvent<HTMLDivElement>) => { if (!reduced) e.currentTarget.style.setProperty("--spec", "1"); }}
      onPointerLeave={(e: PointerEvent<HTMLDivElement>) => e.currentTarget.style.setProperty("--spec", "0")}
      onPointerMove={move}
    >
      <div className="flex items-end gap-4">
        <div>
          <p className="kicker mb-3">{site.readout.atarLabel}</p>
          <p className="atar-num" data-indicative={!v.eligible}>
            <span aria-hidden="true">{has ? fmt(atar, 2) : site.labels.dash}</span>
            <span className="sr-only">{has ? fmt(c.atar, 2) : site.labels.dash}{!v.eligible && has ? ` ${site.readout.indicativeBadge}` : ""}</span>
          </p>
        </div>
        <p className="mb-1 max-w-[24ch] text-[0.88rem] text-foreground-2">{cap}</p>
      </div>
      <div className="grid grid-cols-3 gap-3 md:justify-self-end md:gap-8">
        <Stat className="border-l border-border/10 pl-3" value={fmt(c.aggregate)} label={site.readout.stats.scaled} />
        <Stat className="border-l border-border/10 pl-3" value={fmt(c.rawAggregate)} label={site.readout.stats.raw} />
        <Stat className="border-l border-border/10 pl-3" value={v.totalUnits} label={site.readout.stats.units} />
      </div>
    </Glass>
  );
}

export function Header() {
  const { data } = useCalc();
  return (
    <header className="pt-5 sm:pt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src={mark} alt={site.header.logoAlt} width={56} height={56} className="mark -ml-2 -mt-1 shrink-0" />
          <div>
            <h1 className="text-[1.05rem] font-semibold tracking-[-0.01em]">{site.meta.title}</h1>
            <p className="max-w-[56ch] text-[0.84rem] text-foreground-2">
              <strong className="font-semibold text-foreground">{data.name ? t(site.header.who.named, { name: data.name }) : site.header.who.anon}</strong>{" "}
              {site.header.intro}
            </p>
          </div>
        </div>
        <Toolbar />
      </div>
      <Readout />
    </header>
  );
}
