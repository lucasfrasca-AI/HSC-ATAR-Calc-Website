import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";

type GlassProps<T extends ElementType> = { as?: T; className?: string; children?: ReactNode } & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;
export function Glass<T extends ElementType = "div">({ as, className = "", children, ...rest }: GlassProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={`glass ${className}`} {...rest}>{children}</Tag>;
}

export function Section({ id, title, intro, children, className = "" }: { id?: string; title?: string; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id && title ? `${id}-h` : undefined} className={`mb-12 scroll-mt-6 ${className}`}>
      {title && <h2 id={id ? `${id}-h` : undefined} className="text-[clamp(1.45rem,3vw,2rem)] font-semibold tracking-[-0.025em]">{title}</h2>}
      {intro && <p className="mt-1.5 mb-5 max-w-[74ch] text-[0.92rem] text-foreground-2">{intro}</p>}
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
      onChange={(e) => { setText(e.target.value); const p = parse(e.target.value); if (p !== undefined) onValue?.(p); }}
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
