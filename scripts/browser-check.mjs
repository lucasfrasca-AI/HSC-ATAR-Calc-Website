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
await ev("localStorage.clear(); localStorage.setItem('hsc-guide', 'done')");
await load();
check(problems().length === 0, "no console errors or CSP violations on load", problems().join(" | "));
check(await ev("!document.querySelector('main.fallback') && !!document.querySelector('[role=tablist]')"), "React replaced the no-JS fallback");
check(await ev("document.documentElement.dataset.theme?.length > 0"), "theme set before paint", await ev("document.documentElement.dataset.theme"));
await shot("01-empty-desktop");

// ---- LF monogram: double-click loads the test student, no navigation -------
const logo = await ev("(() => { const r = document.querySelector('header a[href^=\"https://lucasfrasca.com\"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: logo.x, y: logo.y, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: logo.x, y: logo.y, button: "left", clickCount: 1 });
await sleep(60);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: logo.x, y: logo.y, button: "left", clickCount: 2 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: logo.x, y: logo.y, button: "left", clickCount: 2 });
await sleep(900);
check(await ev("location.origin") === new URL(url).origin, "double-clicking the LF logo stays on the calculator");
await sleep(400);
const atar = await ev("document.querySelector('.atar-num .sr-only').textContent.trim()");
check(atar.startsWith("48.64"), "sample student ATAR matches the reference", atar);
const stats = await ev("[...document.querySelectorAll('#readout .num')].map(n => (n.querySelector('.sr-only') ?? n).textContent)");
check(stats[0] === "154.0" && stats[1] === "332.0", "scaled 154.0 / raw 332.0 in the readout", stats.join(", "));
check(await ev("!document.querySelector('.breakdown').open"), "the full breakdown starts folded away (common path first)");
await ev("document.querySelector('.breakdown > summary').click()"); await sleep(400);
check(await ev("document.querySelector('.breakdown').open && !!document.querySelector('#compare table')"), "the breakdown opens to the comparison, counting units and 250 + 250 split");
check(await ev("document.body.innerText.includes('Studies of Religion I — 1 unit')"), "Studies of Religion I unit shown as not counted");

// ---- app layout ---------------------------------------------------------------
const lay = await ev(`(() => { const bar = document.getElementById('appbar').getBoundingClientRect(), tabs = document.querySelector('#tabs [role=tablist]').getBoundingClientRect();
  return { tabsInBar: tabs.top >= bar.top && tabs.bottom <= bar.bottom, barTop: bar.top, sticky: getComputedStyle(document.getElementById('appbar')).position }; })()`);
check(lay.tabsInBar && lay.sticky === "sticky", "desktop: tabs sit as a segmented control inside the sticky app bar", JSON.stringify(lay));
check(await ev("document.querySelector('.compact-atar').dataset.show") === "false", "compact ATAR is hidden while the big number is on screen");
await ev("scrollTo(0, 1400)"); await sleep(500);
check(await ev("document.querySelector('.compact-atar').dataset.show === 'true' && document.querySelector('.compact-atar').textContent.includes(document.querySelector('.atar-num .sr-only').textContent.trim())"), "scrolling past the hero shows the ATAR in the bar");
await ev("scrollTo(0, 0)"); await sleep(300);
await ev("document.querySelector('details.more > summary').click()"); await sleep(200);
check(await ev("['Export data','Import data','Print'].every(l => [...document.querySelectorAll('details.more[open] .menu-item')].some(b => b.textContent.trim() === l))"), "Export, Import and Print live in the More menu");
await ev("document.querySelector('details.more > summary').click()");
check(await ev("[...document.querySelectorAll('.ambient i')].every(i => getComputedStyle(i).animationName === 'none')"), "the background is still (no full-viewport motion)");
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
const px = box.x + box.w * 0.4, py = box.y + box.h * 0.5;   // inside the reachable range for the sample student
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: px, y: py, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px + 40, y: py, button: "left", buttons: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: px + 40, y: py, button: "left", clickCount: 1 });
await sleep(400);
const dragged = await ev("Number(document.querySelector('[role=slider]').getAttribute('aria-valuenow'))");
check(Math.abs(dragged - after) > 5, "dragging the chart moves the pin and the marks", `${after} → ${dragged}`);
check(await ev("document.body.innerText.includes('moved')"), "drag note explains how far subjects moved");

// ---- Apple pass: grab offset, rubber-banding, spring settle -----------------
const pinX = () => ev("(() => { const g = document.querySelector('.pin').parentElement; const m = g.getAttribute('transform').match(/translate\\(([\\d.]+)/); const svg = document.querySelector('svg.chart'); const r = svg.getBoundingClientRect(); return r.left + Number(m[1]) / 640 * r.width; })()");
await sleep(700);
const x0 = await pinX();
const pinY = await ev("document.querySelector('.pin').getBoundingClientRect().top + 10");
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0 + 7, y: pinY, button: "left", clickCount: 1 });
await sleep(120);
const x1 = await pinX();
check(Math.abs(x1 - x0) < 1.5, "grabbing the pin off-centre does not make it jump", `${(x1 - x0).toFixed(2)}px`);
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x0 + 7, y: pinY, button: "left", clickCount: 1 });
await sleep(500);
// Only one subject ticked: the reachable maximum is low, so a long drag right overshoots it.
await ev("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Untick all').click()");
await ev("document.querySelector('[data-focus], #curve aside input[type=checkbox]').click()"); await sleep(300);
const bx = await ev("(() => { const r = document.querySelector('svg.chart').getBoundingClientRect(); return { l: r.left, w: r.width }; })()");
const sx = await pinX();
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: sx, y: pinY, button: "left", clickCount: 1 });
for (let k = 1; k <= 12; k++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: sx + (bx.l + bx.w * 0.97 - sx) * k / 12, y: pinY, button: "left", buttons: 1 }); await sleep(16); }
await sleep(60);
const held = await pinX();
const capAgg = await ev("Number(document.querySelector('[role=slider]').getAttribute('aria-valuenow'))");
const capX = bx.l + (18 + capAgg / 500 * 604) / 640 * bx.w;
check(held > capX + 4 && held < bx.l + bx.w * 0.97 - 10, "past the reachable maximum the pin rubber-bands (follows, but resists)", `cap ${capX.toFixed(0)} · pin ${held.toFixed(0)} · pointer ${(bx.l + bx.w * 0.97).toFixed(0)}`);
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: bx.l + bx.w * 0.97, y: pinY, button: "left", clickCount: 1 });
await sleep(1000);
check(Math.abs(await pinX() - capX) < 2, "on release the pin springs back to the real aggregate", `${(await pinX()).toFixed(0)} vs ${capX.toFixed(0)}`);
await ev("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Tick all').click()"); await sleep(200);

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
check(await ev("[...document.querySelectorAll('#panel-calc section[id]')].map(s => s.id).join(',')") === "curve,projection,compare,units,split,plan", "section order: plan sits after Two halves of 250", await ev("[...document.querySelectorAll('#panel-calc section[id]')].map(s => s.id).join(',')"));
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
const nBefore = await ev("document.querySelectorAll('article[id^=card-]').length");
await ev("document.querySelector('article[id^=card-] button[aria-label^=Remove]').click()"); await sleep(300);
check(await ev("!document.querySelector('dialog.confirm[open]')") && await ev("document.querySelectorAll('article[id^=card-]').length") === nBefore - 1, "removing a subject happens straight away — no confirmation dialog");
check(await ev("!!document.querySelector('.toast .toast-action')"), "the removal toast offers Undo");
await ev("document.querySelector('.toast .toast-action').click()"); await sleep(400);
check(await ev("document.querySelectorAll('article[id^=card-]').length") === nBefore, "Undo in the toast brings the subject back");
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
await ev("localStorage.clear(); localStorage.setItem('hsc-guide', 'done')");
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

// ---- the app bar never overlaps itself, at any desktop width -----------------
for (const w of [1440, 1280, 1100, 1024, 920, 900]) {
  await setViewport(w); await load(url.replace(/#.*$/, "")); await ev("scrollTo(0, 1400)"); await sleep(500);
  const o = await ev(`(() => { const r = e => e.getBoundingClientRect(); const tabs = r(document.querySelector('#tabs [role=tablist]')), acts = r(document.getElementById('appbar-actions')), left = r(document.querySelector('#appbar .compact-atar') ?? document.querySelector('#appbar .monogram'));
    return { gapRight: Math.round(acts.left - tabs.right), gapLeft: Math.round(tabs.left - left.right) }; })()`);
  check(o.gapRight >= 0 && o.gapLeft >= 0, `${w}px: tabs, title and actions in the app bar never overlap`, JSON.stringify(o));
}

// ---- 390px: no horizontal scroll, every tab ------------------------------
await setViewport(390, 844);
await sleep(500);
const tb = await ev("(() => { const r = document.querySelector('#tabs').getBoundingClientRect(); return { bottom: Math.round(r.bottom), vh: innerHeight, top: Math.round(r.top) }; })()");
check(Math.abs(tb.bottom - tb.vh) <= 1 && tb.top > tb.vh - 120, "phone: tabs become a bottom tab bar within thumb reach", JSON.stringify(tb));
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
const rmT = await ev("[...document.querySelectorAll('.odo-strip, .ring-arc, .band-marker, .btn')].map(e => getComputedStyle(e).transitionProperty)");
check(rmT.every((p) => !/transform|left|stroke-dashoffset|\ball\b/.test(p)), "reduced motion: nothing moves (no transform/position transitions)", [...new Set(rmT)].join(" | ").slice(0, 120));
check(rmT.some((p) => /opacity|color/.test(p)), "reduced motion: gentle opacity/colour fades are kept, not removed");
await ev("document.querySelector('details summary.btn').click()"); await sleep(100);
await ev("document.querySelector('input[name=theme][value=blue-light]').click()");
const vtKind = await ev("document.documentElement.dataset.vt ?? 'none'");
await sleep(500);
check(await ev("document.documentElement.dataset.theme === 'blue-light'") && (vtKind === "fade" || vtKind === "none"), "reduced motion: theme change cross-fades (no circular reveal)", vtKind);
await send("Emulation.setEmulatedMedia", { features: [] });

// ---- every theme renders --------------------------------------------------
for (const th of ["violet-dark", "violet-light", "blue-dark", "blue-light", "contrast"]) {
  await ev(`localStorage.setItem('hsc-theme', '${th}')`);
  await load(url.replace(/#.*$/, ""));
  check(await ev(`document.documentElement.dataset.theme === '${th}'`), `saved theme ${th} applies`);
  await shot(`05-theme-${th}`);
}
await ev("localStorage.clear(); localStorage.setItem('hsc-guide', 'done')");

// ---- LF monogram: a single click goes to lucasfrasca.com (last: it navigates away) ----
await load(url.replace(/#.*$/, ""));
const logo2 = await ev("(() => { const r = document.querySelector('header a[href^=\"https://lucasfrasca.com\"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: logo2.x, y: logo2.y, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: logo2.x, y: logo2.y, button: "left", clickCount: 1 });
await sleep(150);
check(await ev("location.origin") === new URL(url).origin, "a single click waits briefly (double-click window) before leaving");
await sleep(2500);
check((await ev("location.host")) === "lucasfrasca.com", "a single click on the LF logo opens lucasfrasca.com", await ev("location.href"));
await load(url.replace(/#.*$/, ""));
await ev("document.querySelector('header a[href^=\"https://lucasfrasca.com\"]').focus()");
await key("Enter", "Enter"); await sleep(2500);
check((await ev("location.host")) === "lucasfrasca.com", "pressing Enter on the focused logo goes straight to lucasfrasca.com");

// ---- theme menu behaves like a native menu: pick closes it, arrows browse, Esc/outside dismiss ----
await setViewport(1440);
await load(url.replace(/#.*$/, ""));
const click = async (sel) => {
  const p = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
};
const themeBox = "document.querySelector('details:has(.theme-menu)')";
await click("details:has(.theme-menu) > summary"); await sleep(300);
check(await ev(`${themeBox}.open`), "clicking the theme button opens the menu");
await click("[data-theme-swatch=blue-dark]"); await sleep(900);
check(await ev(`!${themeBox}.open && document.documentElement.dataset.theme === 'blue-dark'`), "choosing a theme applies it and closes the menu", await ev("document.documentElement.dataset.theme"));
await click("details:has(.theme-menu) > summary"); await sleep(300);
await ev("document.querySelector('input[name=theme]:checked').focus()");
await key("ArrowDown", "ArrowDown"); await sleep(700);
check(await ev(`${themeBox}.open && document.documentElement.dataset.theme !== 'blue-dark'`), "arrow keys preview themes and keep the menu open", await ev("document.documentElement.dataset.theme"));
await key("Enter", "Enter"); await sleep(300);
check(await ev(`!${themeBox}.open && document.activeElement === ${themeBox}.querySelector('summary')`), "Enter commits, closes, and returns focus to the button");
await click("details:has(.theme-menu) > summary"); await sleep(300);
await ev("document.querySelector('input[name=theme]:checked').focus()");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(300);
check(await ev(`!${themeBox}.open`), "Escape closes the theme menu");
await click("details:has(.theme-menu) > summary"); await sleep(300);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 700, y: 600, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 700, y: 600, button: "left", clickCount: 1 }); await sleep(300);
check(await ev(`!${themeBox}.open`), "clicking outside closes the theme menu");
await click("details.more > summary"); await sleep(300);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 700, y: 600, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 700, y: 600, button: "left", clickCount: 1 }); await sleep(300);
check(await ev("!document.querySelector('details.more').open"), "clicking outside closes the More menu");
await ev(`localStorage.setItem("hsc-theme", "violet-dark")`);

// ---- first-visit guide: offered once, follows the data, never blocks ----
await setViewport(1440);
await load(url.replace(/#.*$/, "")); await ev("localStorage.clear()"); await load(url.replace(/#.*$/, "")); await sleep(600);
check(await ev("!!document.querySelector('aside.guide')"), "a first-time visitor is offered the getting-started guide");
check(await ev("document.querySelector('#tab-subj') && !document.querySelector('aside.guide').closest('[aria-modal]') && document.elementFromPoint(400, 400) !== null"), "the guide is not modal (page stays usable)");
await ev("[...document.querySelectorAll('aside.guide .btn')].find(b => b.classList.contains('btn-primary')).click()"); await sleep(900);
check(await ev("document.querySelector('#tab-subj').getAttribute('aria-selected') === 'true' && document.activeElement.id === 'addCourse'"), "Start opens Subjects with the course search focused");
check(await ev("document.getElementById('addCourse').classList.contains('guide-spot')"), "the guide highlights the course search");
await send("Input.insertText", { text: "english standard" }); await sleep(300);
await key("Enter", "Enter"); await sleep(700);
const g2 = await ev("({ kicker: document.querySelector('aside.guide .kicker').textContent, spot: document.querySelector('.guide-spot')?.id ?? '' })");
check(g2.kicker.includes("2") && g2.spot.startsWith("im-"), "adding a subject moves the guide on to its internal mark, highlighted", JSON.stringify(g2));
await ev(`document.getElementById(${JSON.stringify(g2.spot)}).focus()`); await send("Input.insertText", { text: "72" }); await sleep(800);
const g3 = await ev("({ kicker: document.querySelector('aside.guide .kicker').textContent, meter: !!document.querySelector('aside.guide .guide-meter') })");
check(g3.kicker.includes("3") && g3.meter, "a mark moves it to 'add the rest' with a units meter", JSON.stringify(g3));
await ev("document.querySelector('#tab-calc').click()"); await sleep(400);
check(await ev("!!document.querySelector('aside.guide')"), "the student can wander off to another tab; the guide waits");
await ev("document.querySelector('aside.guide .guide-x').click()"); await sleep(300);
check(await ev("!document.querySelector('aside.guide') && localStorage.getItem('hsc-guide') === 'done'"), "closing the guide remembers it");
await load(url.replace(/#.*$/, ""));
check(await ev("!document.querySelector('aside.guide')"), "a returning visitor is not shown the guide again");
await ev("document.querySelector('details.more summary').click()"); await sleep(200);
await ev("[...document.querySelectorAll('.menu-item')].at(-1).click()"); await sleep(700);
check(await ev("!!document.querySelector('aside.guide')"), "the More menu reopens the guide");
await setViewport(390); await sleep(500);
const gp = await ev("(() => { const g = document.querySelector('aside.guide').getBoundingClientRect(), t = document.querySelector('.tabbar').getBoundingClientRect(); return { overlap: g.bottom > t.top, overflow: document.documentElement.scrollWidth > innerWidth }; })()");
check(!gp.overlap && !gp.overflow, "on phones the guide sits above the tab bar without overflow", JSON.stringify(gp));
await setViewport(1440);
await ev("localStorage.setItem('hsc-guide', 'done')");

// ---- past papers: lazy tab, your subjects first, links go straight to NESA's PDFs ----
await setViewport(1440);
await load(url.replace(/#.*$/, ""));
await ev("document.querySelector('.monogram').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2, button: 0 }))"); await sleep(900);
check(await ev("![...document.scripts].some(s => /Papers/.test(s.src)) && !document.getElementById('papers')"), "the papers index is not loaded until its tab opens");
await ev("document.querySelector('#tab-pap').click()"); await sleep(1500);
const pap = await ev("({ n: document.querySelectorAll('#papers details.paper-course').length, first: document.querySelector('#papers details.paper-course b')?.textContent, mineFirst: !!document.querySelector('#papers details.paper-course .pill') })");
check(pap.n > 80 && pap.mineFirst, "Papers lists the NESA courses with the student's own subjects first", JSON.stringify(pap));
await ev("document.querySelector('#papers input[type=search]').value = ''");
await ev("(() => { const i = document.querySelector('#papers input[type=search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'chemistry'); i.dispatchEvent(new Event('input', { bubbles: true })); })()"); await sleep(400);
await ev("document.querySelector('#papers details.paper-course > summary').click()"); await sleep(500);
const links = await ev("[...document.querySelectorAll('#papers details.paper-course[open] a.paper-link')].map(a => ({ h: a.href, t: a.target, r: a.rel }))");
const pdfs = links.filter((l) => l.h.endsWith(".pdf"));
check(pdfs.length >= 10 && pdfs.every((l) => l.h.startsWith("https://www.nsw.gov.au/sites/default/files/") && l.t === "_blank" && l.r.includes("noopener")), "each paper links directly to the official NESA PDF, in a new tab", `${pdfs.length} pdfs, e.g. ${pdfs[0]?.h}`);
check(await ev("document.querySelector('#papers details.paper-course[open] a.paper-link-primary').textContent.startsWith('Exam')"), "the exam itself is the first, emphasised link in each year");
await ev("document.querySelector('#papers .paper-tick input').click()"); await sleep(200);
check(await ev("JSON.parse(localStorage.getItem('hsc-papers-done') || '[]').length === 1 && /1 of \\d+ done/.test(document.querySelector('#papers details.paper-course[open] summary').textContent)"), "ticking a paper as done is remembered and counted");
await ev("document.querySelector('#papers .paper-tick input').click()");

// ---- wayfinding: other tabs open on their own content, the bar carries the ATAR ----
await setViewport(1440);
await load(url.replace(/#.*$/, ""));
await ev("localStorage.clear(); localStorage.setItem('hsc-guide', 'done')"); await load(url.replace(/#.*$/, ""));
await ev("document.querySelector('.monogram').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2, button: 0 }))"); await sleep(900);
await ev("document.querySelector('#tab-subj').click()"); await sleep(900);
const way = await ev("({ top: Math.round(document.querySelector('#panel-subj h2').getBoundingClientRect().top), h1: document.querySelectorAll('h1').length, bar: document.querySelector('.compact-atar')?.dataset.show })");
check(way.top < 300 && way.h1 === 1, "the Subjects tab opens on its own heading, not under the hero", JSON.stringify(way));
check(way.bar === "true", "away from the Calculator, the app bar shows the ATAR", JSON.stringify(way));
await ev("document.querySelector('.compact-atar').click()"); await sleep(900);
check(await ev("document.querySelector('#tab-calc').getAttribute('aria-selected') === 'true' && !!document.querySelector('#readout').offsetParent"), "tapping the bar ATAR returns to the Calculator readout");

// ---- WebGL liquid glass: on by default, steps aside for reduced transparency and contrast ----
await setViewport(1440);
await ev(`localStorage.setItem("hsc-theme", "violet-dark")`);
await load(url.replace(/#.*$/, "")); await sleep(1500);
const lg = await ev("({ on: document.documentElement.classList.contains('lg'), panels: document.querySelectorAll('[data-lg]').length, canvases: document.querySelectorAll('[data-lg] > canvas.lg-panel').length, backdrop: !!document.querySelector('canvas.lg-backdrop'), cssOff: getComputedStyle(document.querySelector('#readout')).backdropFilter })");
check(lg.on && lg.backdrop && lg.panels > 0 && lg.panels === lg.canvases, "WebGL liquid glass draws the backdrop and every visible top-level panel", JSON.stringify(lg));
check(lg.cssOff === "none", "glass panels drop the CSS blur once the shader draws them", lg.cssOff);
const painted = await ev("(() => { const c = document.querySelector('#readout > canvas.lg-panel'); const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return d[3]; })()");
check(painted === 255, "the readout's glass canvas is actually painted (opaque centre)", String(painted));
check(await ev("document.querySelectorAll('dialog [data-lg], .appbar [data-lg], .tabbar [data-lg]').length === 0"), "chrome over content (app bar, tab bar, dialogs) keeps CSS backdrop blur");
await ev("document.documentElement.dataset.theme = 'contrast'"); await sleep(300);
check(await ev("getComputedStyle(document.querySelector('canvas.lg-backdrop')).display === 'none' && getComputedStyle(document.querySelector('#readout')).backgroundColor !== 'rgba(0, 0, 0, 0)'"), "contrast theme hides the shader glass and keeps solid surfaces");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
await load(url.replace(/#.*$/, "")); await sleep(1500);
check(await ev("!document.documentElement.classList.contains('lg') && !document.querySelector('canvas.lg-panel, canvas.lg-backdrop')"), "reduced transparency never starts the WebGL glass");
await send("Emulation.setEmulatedMedia", { features: [] });

ws.close();
console.log(failures ? `browser-check: ${failures} failure(s)` : "browser-check: all passed");
process.exit(failures ? 1 : 0);
