#!/usr/bin/env node
// Real-browser checks over the Chrome DevTools Protocol. Node built-ins only.
// Start Chrome first:
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
//     --remote-debugging-port=9333 --user-data-dir=/tmp/cdp --no-first-run --disable-gpu about:blank &
// Then: node scripts/browser-check.mjs <url> [screenshot-dir]
// Exits non-zero on any failed assertion. Embedded preview panes suspend rAF
// and refuse to scroll — use this for anything involving layout or motion.
import { writeFileSync, mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:4173/";
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });

let tab;
for (let i = 0; i < 40 && !tab; i++) {
  try { tab = (await (await fetch("http://127.0.0.1:9333/json/list")).json()).find((t) => t.type === "page"); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!tab) { console.error("browser-check: no Chrome on :9333 (see header for the launch command)"); process.exit(2); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map(), events = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) pending.get(m.id)?.(m); else events.push(m); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(`${expr.slice(0, 80)} → ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
  return r.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (k, code, mods = 0) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: { Tab: 9, ArrowRight: 39, ArrowLeft: 37, Enter: 13, End: 35, Home: 36 }[k] ?? 0, modifiers: mods });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, modifiers: mods });
};
const shot = async (name) => {
  if (!shots) return;
  const { result } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`${shots}/${name}.png`, Buffer.from(result.data, "base64"));
};

let failures = 0;
const check = (ok, label, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };

await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
const setViewport = (w, h = 900) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: w < 768 });
const load = async (u = url) => { events.length = 0; await send("Page.navigate", { url: u }); await sleep(1800); };
const problems = () => events.filter((e) => e.method === "Log.entryAdded" || e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"))
  .map((e) => (e.params.entry?.text ?? e.params.exceptionDetails?.exception?.description ?? JSON.stringify(e.params.args)).slice(0, 200));

// ---- fresh visit, desktop --------------------------------------------------
await setViewport(1440);
await load();
await ev("localStorage.clear()");
await load();
check(problems().length === 0, "no console errors or CSP violations on load", problems().join(" | "));
check(await ev("!document.querySelector('main.fallback') && !!document.querySelector('[role=tablist]')"), "React replaced the no-JS fallback");
check(await ev("document.documentElement.dataset.theme?.length > 0"), "theme set before paint", await ev("document.documentElement.dataset.theme"));
await shot("01-empty-desktop");

// ---- load the test student and compare with the reference numbers ---------
await ev("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add test data instead').click()");
await sleep(900);
const atar = await ev("document.querySelector('.atar-num .sr-only').textContent.trim()");
check(atar.startsWith("63.14"), "sample student ATAR matches the reference", atar);
const stats = await ev("[...document.querySelectorAll('header .num')].map(n => n.textContent)");
check(stats[0] === "223.1" && stats[1] === "366.5", "scaled 223.1 / raw 366.5 in the readout", stats.join(", "));
check(await ev("document.body.innerText.includes('Studies of Religion I — 1 unit')"), "Studies of Religion I unit shown as not counted");
await shot("02-sample-desktop");

// ---- the pin: keyboard slider moves the aggregate --------------------------
await ev("document.querySelector('[role=slider]').focus()");
const before = await ev("Number(document.querySelector('[role=slider]').getAttribute('aria-valuenow'))");
await key("ArrowRight", "ArrowRight", 8 /* shift */);
await sleep(300);
const after = await ev("Number(document.querySelector('[role=slider]').getAttribute('aria-valuenow'))");
check(Math.abs(after - before - 10) < 0.6, "Shift+ArrowRight on the pin raises the aggregate by 10", `${before} → ${after}`);
check(await ev("getComputedStyle(document.activeElement.querySelector('.pin-halo')).stroke !== 'none'"), "pin shows a focus ring");

// ---- the pin: pointer drag -------------------------------------------------
const box = await ev("(() => { const r = document.querySelector('svg.chart').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()");
const px = box.x + box.w * 0.62, py = box.y + box.h * 0.5;
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: px, y: py, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px + 40, y: py, button: "left", buttons: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: px + 40, y: py, button: "left", clickCount: 1 });
await sleep(400);
const dragged = await ev("Number(document.querySelector('[role=slider]').getAttribute('aria-valuenow'))");
check(Math.abs(dragged - after) > 5, "dragging the chart moves the pin and the marks", `${after} → ${dragged}`);
check(await ev("document.body.innerText.includes('moved')"), "drag note explains how far subjects moved");

// ---- tabs: keyboard + hash + back -----------------------------------------
await ev("document.querySelector('#tab-calc').focus()");
await key("ArrowRight", "ArrowRight");
await sleep(300);
check(await ev("location.hash === '#subjects' && document.activeElement.id === 'tab-subj' && !document.querySelector('#panel-subj').hidden"), "ArrowRight moves to the Subjects tab and updates the URL");
await key("ArrowRight", "ArrowRight");
await sleep(900);
check(await ev("document.querySelectorAll('#panel-help tbody tr').length > 100"), "How it works lazy-loads the full course table", `${await ev("document.querySelectorAll('#panel-help tbody tr').length")} rows`);
await ev("history.back()"); await sleep(300);
check(await ev("location.hash === '#subjects' && !document.querySelector('#panel-subj').hidden"), "browser Back returns to the previous tab");
await shot("03-subjects-desktop");

// ---- keyboard-only: everything reachable, focus visible --------------------
await load(url.replace(/#.*$/, ""));
await ev("document.activeElement.blur(); window.scrollTo(0,0)");
const seen = [];
let invisible = 0;
await ev("document.querySelectorAll('[data-tab-seen]').forEach(e => e.removeAttribute('data-tab-seen'))");
for (let i = 0; i < 400; i++) {
  await key("Tab", "Tab");
  const info = await ev(`(() => { const a = document.activeElement; if (!a || a === document.body) return null;
    if (a.hasAttribute('data-tab-seen')) return { again: true };
    a.setAttribute('data-tab-seen', '');
    const cs = getComputedStyle(a); const halo = a.querySelector && a.querySelector('.pin-halo');
    const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (halo && getComputedStyle(halo).stroke !== 'none');
    return { tag: a.tagName, id: a.id, label: (a.getAttribute('aria-label') || a.textContent || a.name || '').trim().slice(0, 40), ring }; })()`);
  if (!info || info.again) break;
  const sig = `${info.tag}#${info.id}:${info.label}`;
  seen.push(sig);
  if (!info.ring) { invisible++; console.log(`     no visible focus: ${sig}`); }
}
check(seen.length > 40, "Tab walks through the page", `${seen.length} stops`);
check(invisible === 0, "every focus stop has a visible ring", `${invisible} without`);
check(seen.some((s) => s.includes("Skip to content")), "skip link is the first stop", seen[0]);

// ---- 390px: no horizontal scroll, every tab ------------------------------
await setViewport(390, 844);
for (const h of ["", "#subjects", "#how-it-works"]) {
  await load(url.replace(/#.*$/, "") + h); await sleep(400);
  const w = await ev("({ s: document.documentElement.scrollWidth, i: innerWidth })");
  check(w.s <= w.i, `390px ${h || "#calculator"}: no horizontal page scroll`, `${w.s} vs ${w.i}`);
  await shot(`04-mobile${h.replace("#", "-") || "-calculator"}`);
}

// ---- reduced motion --------------------------------------------------------
await setViewport(1440);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await load(url.replace(/#.*$/, ""));
const rm = await ev(`(() => { const blob = getComputedStyle(document.querySelector('.ambient i')).animationName;
  return { blob, js: matchMedia('(prefers-reduced-motion: reduce)').matches }; })()`);
check(rm.js && rm.blob === "none", "reduced motion: ambient animation off, JS sees the preference", JSON.stringify(rm));
await ev("document.querySelector('[role=slider]').focus()");
await key("End", "End");
await sleep(30);
const jumped = await ev("document.querySelector('.atar-num [aria-hidden]').textContent === document.querySelector('.atar-num .sr-only').textContent.slice(0, document.querySelector('.atar-num [aria-hidden]').textContent.length)");
check(jumped, "reduced motion: the ATAR jumps to its value instead of counting");
await send("Emulation.setEmulatedMedia", { features: [] });

// ---- every theme renders --------------------------------------------------
for (const th of ["violet-dark", "violet-light", "blue-dark", "blue-light", "contrast"]) {
  await ev(`localStorage.setItem('hsc-theme', '${th}')`);
  await load(url.replace(/#.*$/, ""));
  check(await ev(`document.documentElement.dataset.theme === '${th}'`), `saved theme ${th} applies`);
  await shot(`05-theme-${th}`);
}
await ev("localStorage.clear()");

ws.close();
console.log(failures ? `browser-check: ${failures} failure(s)` : "browser-check: all passed");
process.exit(failures ? 1 : 0);
