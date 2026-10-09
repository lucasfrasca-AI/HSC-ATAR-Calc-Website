// localStorage access that never throws (private mode, blocked storage).
export const STORE_KEY = "hsc-atar-calculator-v4";
export const THEME_KEY = "hsc-theme";
export function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: keep working in memory */ }
}
