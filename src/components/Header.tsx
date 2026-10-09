import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import site from "../../content/site.json";
import mark from "../assets/lf-mark.png";
import { fmt, sanitise } from "../lib/engine.ts";
import { useReducedMotion, withTransition } from "../lib/motion.ts";
import { useCalc } from "../lib/state.tsx";
import { t } from "../lib/text.ts";
import { THEMES, currentTheme, setTheme, type ThemeId } from "../lib/theme.ts";
import { useFeedback } from "./Feedback.tsx";
import { ShareButton } from "./ShareDialog.tsx";
import { Glass, Stat, TweenNum } from "./ui.tsx";

function ThemePicker() {
  const [theme, set] = useState<ThemeId>(currentTheme);
  const summary = useRef<HTMLElement>(null);
  const name = THEMES.find((x) => x.id === theme)?.name;
  const choose = (id: ThemeId) => {
    const r = summary.current?.getBoundingClientRect();
    withTransition("theme", () => { setTheme(id); set(id); }, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined);
  };
  return (
    <details className="relative">
      <summary ref={summary} className="btn" aria-label={`${site.theme.label}: ${name}`}>
        <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-accent-fill" />
        {name}
      </summary>
      <Glass as="fieldset" className="theme-menu glass-sm absolute right-0 z-20 mt-2 w-52 p-2">
        <legend className="sr-only">{site.theme.label}</legend>
        {THEMES.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-foreground/5">
            <input type="radio" name="theme" value={o.id} checked={theme === o.id} onChange={() => choose(o.id)} />
            <span data-theme-swatch={o.id}>{o.name}</span>
          </label>
        ))}
      </Glass>
    </details>
  );
}

function Toolbar() {
  const { data, replace, undo, redo, canUndo, canRedo } = useCalc();
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
      <div className="flex gap-1" role="group" aria-label={`${site.toolbar.undo} / ${site.toolbar.redo}`}>
        <button type="button" className="btn !px-3" disabled={!canUndo} aria-label={site.toolbar.undoLabel} title={site.toolbar.shortcutsHint} onClick={() => { if (undo()) toast(site.toolbar.undone); }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
          <span className="sr-only sm:not-sr-only">{site.toolbar.undo}</span>
        </button>
        <button type="button" className="btn !px-3" disabled={!canRedo} aria-label={site.toolbar.redoLabel} onClick={() => { if (redo()) toast(site.toolbar.redone); }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
          <span className="sr-only sm:not-sr-only">{site.toolbar.redo}</span>
        </button>
      </div>
      <ThemePicker />
      <ShareButton />
      <button type="button" className="btn" onClick={exportData}>{site.toolbar.export}</button>
      <button type="button" className="btn" onClick={() => file.current?.click()}>{site.toolbar.import}</button>
      <input ref={file} type="file" accept="application/json,.json" hidden aria-label={site.toolbar.importLabel} onChange={importData} />
      <button type="button" className="btn" onClick={() => window.print()}>{site.toolbar.print}</button>
    </div>
  );
}

/** Mechanical-counter digits: each digit column rolls to its value. Keys count from the
 *  right so the units digit keeps its column when the number gains a digit. */
function Odometer({ text }: { text: string }) {
  const chars = [...text];
  return (
    <span className="odo" aria-hidden="true">
      {chars.map((ch, i) => {
        const key = chars.length - i;
        return /\d/.test(ch) ? (
          <span key={key} className="odo-col">
            <span className="odo-strip" style={{ transform: `translateY(${-Number(ch) * 10}%)`, transitionDelay: `${(chars.length - i) * 35}ms` }}>
              {"0123456789".split("").map((d) => <span key={d}>{d}</span>)}
            </span>
          </span>
        ) : <span key={key} className="odo-sep">{ch}</span>;
      })}
    </span>
  );
}

/** Slim ring: the share of the Year 12 age group finished above (an ATAR is that rank). */
function PercentileRing({ atar }: { atar: number }) {
  const R = 19, C = 2 * Math.PI * R;
  return (
    <svg className="pct-ring" width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
      <circle className="ring-track" cx="23" cy="23" r={R} />
      <circle className="ring-arc" cx="23" cy="23" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(100, atar)) / 100)} transform="rotate(-90 23 23)" />
    </svg>
  );
}

function Readout() {
  const { data, v, c } = useCalc();
  const reduced = useReducedMotion();
  const has = data.subjects.length > 0 && c.counted.length > 0;
  // A light sweep across the card once the projection settles on a new value.
  const [sweep, setSweep] = useState(0);
  const settled = has ? c.atar.toFixed(2) : "";
  useEffect(() => {
    if (!settled || reduced) return;
    const id = window.setTimeout(() => setSweep((n) => n + 1), 260);
    return () => window.clearTimeout(id);
  }, [settled, reduced]);
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
      className="rise glass-refract glass-spec mt-6 grid gap-6 p-5 sm:p-7 md:grid-cols-[auto_1fr] md:items-end"
      onPointerEnter={(e: PointerEvent<HTMLDivElement>) => { if (!reduced) e.currentTarget.style.setProperty("--spec", "1"); }}
      onPointerLeave={(e: PointerEvent<HTMLDivElement>) => e.currentTarget.style.setProperty("--spec", "0")}
      onPointerMove={move}
    >
      {sweep > 0 && <span key={sweep} aria-hidden="true" className="sweep" />}
      <div className="flex items-end gap-4">
        <div>
          <p className="kicker mb-3">{site.readout.atarLabel}</p>
          <p className="atar-num" data-indicative={!v.eligible}>
            {has ? <Odometer text={fmt(c.atar, 2)} /> : <span aria-hidden="true">{site.labels.dash}</span>}
            <span className="sr-only">{has ? fmt(c.atar, 2) : site.labels.dash}{!v.eligible && has ? ` ${site.readout.indicativeBadge}` : ""}</span>
          </p>
        </div>
        <div className="mb-1 max-w-[26ch]">
          <p className="text-[0.88rem] text-foreground-2">{cap}</p>
          {has && (
            <p className="mt-2.5 flex items-center gap-2.5 text-[0.78rem] text-foreground-3" title={t(site.readout.ring, { pct: Math.round(c.atar) })}>
              <PercentileRing atar={c.atar} />
              <span>{t(site.readout.ringShort, { pct: Math.round(c.atar) })}<span className="sr-only">. {t(site.readout.ring, { pct: Math.round(c.atar) })}</span></span>
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 md:justify-self-end md:gap-8">
        <Stat className="border-l border-border/10 pl-3" value={<TweenNum value={c.aggregate} />} label={site.readout.stats.scaled} />
        <Stat className="border-l border-border/10 pl-3" value={<TweenNum value={c.rawAggregate} />} label={site.readout.stats.raw} />
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
