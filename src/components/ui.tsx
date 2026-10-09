import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties, type ElementType, type ReactNode } from "react";
import site from "../../content/site.json";
import { fmt } from "../lib/engine.ts";
import { useTween } from "../lib/motion.ts";
import { typing } from "../lib/state.tsx";

type GlassProps<T extends ElementType> = { as?: T; className?: string; children?: ReactNode } & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;
export function Glass<T extends ElementType = "div">({ as, className = "", children, ...rest }: GlassProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={`glass ${className}`} {...rest}>{children}</Tag>;
}

export function Section({ id, title, intro, kicker, children, className = "" }: { id?: string; title?: string; intro?: ReactNode; kicker?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id && title ? `${id}-h` : undefined} className={`mb-20 scroll-mt-24 ${className}`}>
      {kicker && <p className="kicker mb-2 flex items-center gap-2.5"><span aria-hidden="true" className="inline-block h-px w-6 bg-accent/70" />{kicker}</p>}
      {title && <h2 id={id ? `${id}-h` : undefined} className="font-semibold">{title}</h2>}
      {intro && <p className="mt-2.5 mb-6 max-w-[68ch] text-[1rem] leading-relaxed text-foreground-2">{intro}</p>}
      {children}
    </section>
  );
}

/**
 * Number input that keeps whatever the user is typing while focused and
 * re-syncs from the model when it isn't — so a recompute never interrupts typing.
 * `onValue` fires with null for blank, or the number; invalid text is flagged, not sent.
 */
export function NumInput({ value, onValue, onCommit, min, max, step, integer, className = "", invalid, ...rest }: {
  value: number | null; onValue?: (v: number | null) => void; onCommit?: (v: number | null) => void;
  min?: number; max?: number; step?: number; integer?: boolean; invalid?: boolean;
} & Omit<ComponentPropsWithoutRef<"input">, "value" | "onChange" | "type" | "min" | "max" | "step">) {
  const shown = value === null || value === undefined ? "" : String(Math.round(value * 100) / 100);
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(shown); }, [shown]);
  const parse = (s: string): number | null | undefined => {
    if (s.trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const n = parse(text);
  const bad = invalid || n === undefined || (n !== null && ((min !== undefined && n < min) || (max !== undefined && n > max) || (integer && !Number.isInteger(n))));
  return (
    <input
      {...rest}
      type="number" inputMode={integer ? "numeric" : "decimal"} min={min} max={max} step={step}
      className={`input input-num ${className}`}
      value={text}
      aria-invalid={bad || undefined}
      onFocus={(e) => { focused.current = true; rest.onFocus?.(e); }}
      onBlur={(e) => { focused.current = false; const p = parse(text); if (p !== undefined) onCommit?.(p); setText(shown); rest.onBlur?.(e); }}
      onKeyDown={(e) => { if (e.key === "Enter" && onCommit) (e.target as HTMLInputElement).blur(); rest.onKeyDown?.(e); }}
      onChange={(e) => { setText(e.target.value); const p = parse(e.target.value); if (p !== undefined) typing(e.currentTarget, () => onValue?.(p)); }}
    />
  );
}

export function Stat({ value, label, className = "" }: { value: ReactNode; label: string; className?: string }) {
  return (
    <div className={className}>
      <span className="block text-[1.2rem] font-semibold tracking-[-0.02em] sm:text-[1.45rem] num">{value}</span>
      <span className="block text-[0.7rem] leading-tight text-foreground-3 sm:text-[0.76rem]">{label}</span>
    </div>
  );
}

/** A number that counts to its new value (rAF, reduced-motion aware). Screen readers get the final value only. */
export function TweenNum({ value, digits = 1, suffix = "" }: { value: number | null; digits?: number; suffix?: string }) {
  const shown = useTween(value ?? 0);
  if (value === null || !Number.isFinite(value)) return <>{site.labels.dash}</>;
  return <><span aria-hidden="true">{fmt(shown, digits)}{suffix}</span><span className="sr-only">{fmt(value, digits)}{suffix}</span></>;
}

/** Native range input with the glass thumb and an accent fill up to the value. */
export function Range({ value, min, max, className = "", onChange, ...rest }: { value: number; min: number; max: number } & Omit<ComponentPropsWithoutRef<"input">, "type" | "value" | "min" | "max">) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return <input {...rest} onChange={(e) => typing(e.currentTarget, () => onChange?.(e))} type="range" min={min} max={max} value={value} className={`glide ${className}`} style={{ "--fill": `${Math.max(0, Math.min(100, pct))}%` } as CSSProperties} />;
}

/** Text input whose keystrokes merge into one undo step (see typing()). */
export function TextInput({ onText, ...rest }: { onText: (v: string) => void } & Omit<ComponentPropsWithoutRef<"input">, "onChange" | "type">) {
  return <input {...rest} type="text" onChange={(e) => typing(e.currentTarget, () => onText(e.target.value))} />;
}
