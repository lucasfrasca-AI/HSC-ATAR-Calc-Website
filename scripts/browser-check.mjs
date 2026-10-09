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
const stats = await ev("[...document.querySelectorAll('header .num')].map(n => (n.querySelector('.sr-only') ?? n).textContent)");
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

// ---- where marks matter most ---------------------------------------------
const impact = await ev("[...document.querySelectorAll('[aria-labelledby=impact-h] li')].map(li => parseFloat(li.querySelector('.text-right')?.textContent.replace('+','')))");
check(impact.length === 6 && impact.every((v, i) => i === 0 || impact[i - 1] >= v), "impact panel ranks all 6 subjects by ATAR gain", impact.join(", "));
const place = await ev(`(() => { const chart = document.querySelector('svg.chart').closest('.glass').getBoundingClientRect(), imp = document.querySelector('[aria-labelledby=impact-h]').getBoundingClientRect(), aside = document.querySelector('#curve aside').getBoundingClientRect();
  return { below: imp.top >= chart.bottom - 1, sameCol: Math.abs(imp.left - chart.left) < 2, besideAside: imp.right < aside.left }; })()`);
check(place.below && place.sameCol && place.besideAside, "desktop: impact panel sits under the chart, left of the goal panel", JSON.stringify(place));

// ---- odometer + ring agree with the real value ------------------------------
await sleep(1200);
const odo = await ev(`(() => { const real = document.querySelector('.atar-num .sr-only').textContent.trim();
  const shown = [...document.querySelector('.odo').children].map(c => c.classList.contains('odo-col') ? String(Math.round(-parseFloat(c.firstElementChild.style.transform.match(/-?[\\d.]+/)[0]) / 10)) : c.textContent).join('');
  const arc = document.querySelector('.ring-arc'), C = parseFloat(arc.getAttribute('stroke-dasharray')), off = parseFloat(arc.getAttribute('stroke-dashoffset'));
  return { real, shown, ringPct: (1 - off / C) * 100 }; })()`);
check(odo.real.startsWith(odo.shown), "odometer digits show the projected ATAR", `${odo.shown} vs ${odo.real}`);
check(Math.abs(odo.ringPct - parseFloat(odo.real)) < 0.01, "percentile ring matches the ATAR", odo.ringPct.toFixed(2));

// ---- band ladder ------------------------------------------------------------
const bands = await ev(`[...document.querySelectorAll('.band-track')].map(b => ({ on: b.querySelectorAll('[data-on=true]').length, text: b.nextElementSibling.textContent }))`);
check(bands.length === 6 && bands.every((b) => b.on === 1 && /Band \d needs an exam mark of|Band 6 range|out of reach/.test(b.text)), "every subject card shows its band and the next band's exam mark", bands.map((b) => b.text.slice(0, 40)).join(" | "));

// ---- smart plan -------------------------------------------------------------
// Known state: what-if marks back to internal marks, then a target 6 above the current ATAR.
await ev("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Reset to internal marks').click()"); await sleep(600);
const baseAtar = parseFloat(await ev("document.querySelector('.atar-num .sr-only').textContent"));
const planTarget = Math.round((baseAtar + 6) * 100) / 100;
await ev("document.getElementById('planTarget').focus()");
await ev(`(() => { const el = document.getElementById('planTarget'); el.select(); })()`);
await send("Input.insertText", { text: String(planTarget) });
await key("Enter", "Enter"); await sleep(500);
const planTotal = await ev("document.querySelector('#plan b.num .sr-only')?.textContent");
check(planTotal !== undefined && Number(planTotal) > 0, "planner proposes a number of extra marks", `${planTotal} marks for ATAR ${planTarget}`);
check(await ev("![...document.querySelectorAll('#plan button')].find(b => b.textContent.includes('Apply')).disabled"), "Apply is enabled for a reachable target");
await ev("[...document.querySelectorAll('#plan button')].find(b => b.textContent.includes('Apply')).click()"); await sleep(500);
const afterPlan = parseFloat(await ev("document.querySelector('.atar-num .sr-only').textContent"));
check(afterPlan >= planTarget - 0.05, "applying the plan reaches the target ATAR", `${afterPlan} ≥ ${planTarget}`);
await ev("document.activeElement.blur()");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 4 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 4 });
await sleep(400);
check(Math.abs(parseFloat(await ev("document.querySelector('.atar-num .sr-only').textContent")) - baseAtar) < 0.005, "undo returns exactly to the pre-plan ATAR", String(baseAtar));

// ---- undo / redo -----------------------------------------------------------
const atarBefore = await ev("document.querySelector('.atar-num .sr-only').textContent.trim()");
await ev("document.querySelector('[role=slider]').focus()");
await key("End", "End"); await sleep(250);
const atarMoved = await ev("document.querySelector('.atar-num .sr-only').textContent.trim()");
await ev("document.activeElement.blur()");
await sleep(800);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 4 /* meta */ });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 4 });
await sleep(300);
const atarUndone = await ev("document.querySelector('.atar-num .sr-only').textContent.trim()");
check(atarMoved !== atarBefore && atarUndone === atarBefore, "Cmd+Z undoes a pin move", `${atarBefore} → ${atarMoved} → ${atarUndone}`);
await ev("document.querySelector('[aria-label=Redo]').click()"); await sleep(300);
check(await ev("document.querySelector('.atar-num .sr-only').textContent.trim()") === atarMoved, "Redo button restores it");

// ---- course search combobox ----------------------------------------------
await ev("location.hash = '#subjects'"); await sleep(500);
await ev("document.getElementById('addCourse').focus()");
await send("Input.insertText", { text: "chem" }); await sleep(250);
const opts = await ev("[...document.querySelectorAll('[role=listbox] [role=option]')].map(o => o.textContent)");
check(opts.length >= 1 && opts[0].startsWith("Chemistry"), "typing 'chem' lists Chemistry first", opts.slice(0, 3).join(" | "));
check(await ev("document.getElementById('addCourse').getAttribute('aria-activedescendant')?.length > 0"), "combobox exposes the active option to screen readers");
const n0 = await ev("document.querySelectorAll('article[id^=card-]').length");
await key("Enter", "Enter"); await sleep(400);
check(await ev("document.querySelectorAll('article[id^=card-]').length") === n0 + 1 && await ev("document.activeElement.id === 'addCourse' && document.activeElement.value === ''"),
  "Enter adds the course and keeps focus in the search for the next one");
await ev("location.hash = '#calculator'"); await sleep(400);

// ---- tabs: keyboard + hash + back -----------------------------------------
await ev("document.querySelector('#tab-calc').focus()");
await key("ArrowRight", "ArrowRight");
await sleep(300);
check(await ev("location.hash === '#subjects' && document.activeElement.id === 'tab-subj' && !document.querySelector('#panel-subj').hidden"), "ArrowRight moves to the Subjects tab and updates the URL");
await sleep(500);
const glider = await ev("(() => { const g = document.querySelector('.tab-glider'), t = document.getElementById('tab-subj'); return g ? Math.abs(g.getBoundingClientRect().left - t.getBoundingClientRect().left) : -1; })()");
check(glider >= 0 && glider < 2, "tab indicator glides under the selected tab", `${glider}px off`);
await key("ArrowRight", "ArrowRight");
await sleep(900);
check(await ev("location.hash === '#syllabuses' && document.querySelectorAll('#panel-syl a[href^=\"https://\"]').length > 100"), "Syllabuses tab lazy-loads its links", `${await ev("document.querySelectorAll('#panel-syl a[href^=\"https://\"]').length")} links`);
await key("End", "End");
await sleep(900);
check(await ev("document.querySelectorAll('#panel-help tbody tr').length > 100"), "How it works lazy-loads the full course table", `${await ev("document.querySelectorAll('#panel-help tbody tr').length")} rows`);
await ev("history.back()"); await sleep(400);
check(await ev("location.hash === '#syllabuses' && !document.querySelector('#panel-syl').hidden"), "browser Back returns to the previous tab");

// ---- syllabuses ------------------------------------------------------------
const syl = await ev(`(() => { const cards = [...document.querySelectorAll('#panel-syl li.rise')];
  const links = [...document.querySelectorAll('#panel-syl a[href^="https://"]')];
  return { cards: cards.length, safe: links.every(a => a.target === '_blank' && a.rel.includes('noopener') && a.rel.includes('noreferrer')),
    hosts: [...new Set(links.map(a => new URL(a.href).host))] }; })()`);
check(syl.cards === 115, "every course has a syllabus card", `${syl.cards} cards`);
check(syl.safe, "syllabus links open in a new tab with noopener noreferrer");
check(syl.hosts.every((h) => ["curriculum.nsw.edu.au", "www.nsw.gov.au"].includes(h)), "syllabus links only point at NESA hosts", syl.hosts.join(", "));
await ev("document.querySelector('#panel-syl input[type=search]').focus()");
await send("Input.insertText", { text: "physics" }); await sleep(300);
check(await ev("document.querySelectorAll('#panel-syl li.rise').length") === 1, "syllabus search narrows to Physics");

// ---- share link: create, open in a fresh visit, confirm, compare -----------
await ev("location.hash = '#calculator'"); await sleep(300);
const sharedAtar = await ev("document.querySelector('.atar-num .sr-only').textContent.trim()");
const sharedN = await ev("JSON.parse(localStorage.getItem('hsc-atar-calculator-v4')).subjects.length");
await ev("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Share').click()"); await sleep(600);
const link = await ev("document.getElementById('share-link').value");
check(link.includes("#share=v1.") && !link.includes("Sample"), "share link is built in the fragment, without the name by default", `${link.length} chars`);
await ev("document.querySelector('dialog[open] .btn-primary').click()");
await ev("localStorage.clear()");
await load(link); await sleep(500);
check(await ev("!!document.querySelector('dialog.confirm[open]') && document.getElementById('confirm-q').textContent.includes('" + sharedN + " subjects')"), "opening a share link asks before replacing anything", `${sharedN} subjects`);
check(await ev("!location.hash.includes('share=')"), "the shared marks are cleared from the address bar immediately");
await ev("document.querySelector('dialog.confirm[open] .btn-primary').click()"); await sleep(900);
check(await ev("document.querySelector('.atar-num .sr-only').textContent.trim()") === sharedAtar, "the opened projection reproduces the same ATAR", sharedAtar);
await load(url.replace(/#.*$/, "") + "#share=v1.!!broken!!"); await sleep(500);
check(await ev("!document.querySelector('dialog.confirm[open]') && document.querySelector('.toast').textContent.includes('damaged')"), "a damaged share link is refused with a message");
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
for (const h of ["", "#subjects", "#syllabuses", "#how-it-works"]) {
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
const jumped = await ev("[...document.querySelectorAll('.odo-strip, .ring-arc, .band-marker')].every(e => parseFloat(getComputedStyle(e).transitionDuration) < 0.001)");
check(jumped, "reduced motion: odometer, ring and band markers jump instead of animating");
await ev("document.querySelector('details summary.btn').click()"); await sleep(100);
await ev("document.querySelector('input[name=theme][value=blue-light]').click()"); await sleep(60);
check(await ev("document.documentElement.dataset.theme === 'blue-light' && !document.documentElement.dataset.vt"), "reduced motion: theme switches instantly, no view transition");
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
