import site from "../../content/site.json";
import { THEME_KEY, write } from "./storage.ts";

export type ThemeId = (typeof site.theme.options)[number]["id"];
export const THEMES = site.theme.options;
export const currentTheme = (): ThemeId => (document.documentElement.dataset.theme as ThemeId) ?? "violet-dark";
/** Pre-paint choice happens in index.html; this applies and remembers an explicit choice. */
export function setTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  write(THEME_KEY, id);
}
