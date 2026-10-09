// Copy helpers. All strings come from content/*.json; this only fills {slots}.
import messages from "../../content/messages.json" with { type: "json" };
import type { Issue } from "./engine.ts";

export type Vars = Record<string, string | number>;
export const t = (template: string, vars: Vars = {}): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
export const msg = (i: Issue): string => t((messages as Record<string, string>)[i.key] ?? i.key, i.vars);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Signed number with a true minus sign. */
export const signed = (n: number, d = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;
