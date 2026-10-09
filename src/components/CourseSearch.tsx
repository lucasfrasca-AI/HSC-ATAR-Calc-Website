// ARIA 1.2 combobox: type to filter 116 courses, arrows to move, Enter to pick.
// Matches name, learning area or NESA course number.
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import sub from "../../content/subjects.json";
import { CATALOG, type Course } from "../lib/catalog.ts";
import { t } from "../lib/text.ts";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, " ");
function highlight(name: string, q: string): ReactNode {
  const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return name;
  return <>{name.slice(0, i)}<mark>{name.slice(i, i + q.length)}</mark>{name.slice(i + q.length)}</>;
}

export function CourseSearch({ onPick, inputId }: { onPick: (c: Course) => void; inputId: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const pool = CATALOG.filter((c) => {
      const hay = norm(`${c.name} ${c.area} ${c.nesaCode ?? ""}`);
      return words.every((w) => hay.includes(w));
    });
    // Names starting with the query first, then the rest in catalogue order.
    const first = norm(q).trim();
    return first ? [...pool.filter((c) => norm(c.name).startsWith(first)), ...pool.filter((c) => !norm(c.name).startsWith(first))] : pool;
  }, [q]);
  const act = Math.min(active, Math.max(0, results.length - 1));

  const move = (n: number) => {
    const next = (act + n + results.length) % results.length;
    setActive(next); setOpen(true);
    list.current?.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const pick = (c: Course | undefined) => {
    if (!c) return;
    onPick(c); setQ(""); setActive(0); setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { if (open && results.length) { e.preventDefault(); pick(results[act]); } }
    else if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); } else setQ(""); }
    else if (e.key === "Home" && open) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && open) { e.preventDefault(); setActive(results.length - 1); }
  };

  return (
    <div className="relative z-30">
      <input
        id={inputId} className="input" type="text" role="combobox" autoComplete="off" spellCheck={false}
        aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-describedby={`${inputId}-hint`}
        aria-activedescendant={open && results.length ? `${listId}-${act}` : undefined}
        placeholder={sub.add.searchPlaceholder} value={q}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(q.length > 0)} onClick={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey}
      />
      <span id={`${inputId}-hint`} className="help mt-1 block">{sub.add.hint}</span>
      <span className="sr-only" role="status" aria-live="polite">{open ? (results.length ? t(results.length === 1 ? sub.add.results1 : sub.add.results, { n: results.length }) : t(sub.add.noResults, { q })) : ""}</span>
      {open && (
        <ul ref={list} id={listId} role="listbox" aria-label={sub.add.search} className="listbox reveal">
          {results.length ? results.map((c, i) => (
            <li
              key={c.id} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={i === act}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(c)}
            >
              <span>{highlight(c.name, q.trim())}</span>
              <small>{c.area}</small>
            </li>
          )) : <li role="presentation" className="px-2.5 py-2 text-[0.86rem] text-foreground-3">{t(sub.add.noResults, { q })}</li>}
        </ul>
      )}
    </div>
  );
}
