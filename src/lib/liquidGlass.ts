// Real liquid glass: a WebGL port of the refraction model in ybouane/liquidglass (MIT) —
// rounded-rect SDF, biconvex bevel height field, dual-surface refraction, chromatic
// aberration, Fresnel, specular rim, inner stroke and a drop shadow.
//
// The library rasterises the DOM behind each panel (html-to-image, data: URIs, a canvas
// per frame). We don't need that: every glass panel here sits on the page backdrop, and
// the backdrop is a static scene we draw ourselves. So the scene is a GLSL function,
// the same function paints the fixed backdrop canvas, and each panel's shader samples it
// at its refracted screen position — no capture, no extra CSP sources, one GL context.
//
// Progressive enhancement: loaded lazily after first paint; CSS glass (backdrop-filter)
// stays the fallback for no-WebGL, reduced transparency, the contrast theme and print.
// The panel tint is the same --surface / --glass-alpha as the CSS glass and the centre of
// a panel gets no highlights, so check-contrast's composite is still the worst case.

const VS = `
attribute vec2 a_pos;
uniform vec2 u_total;
varying vec2 v_local;
void main() {
  v_local = vec2(a_pos.x, -a_pos.y) * 0.5 * u_total;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const SCENE = `
uniform vec2 u_res;
uniform vec3 u_bg, u_g1, u_g2, u_g3, u_fg;
uniform float u_ga, u_grid;
float blob(vec2 p, vec2 c, float r) { vec2 d = (p - c) / r; return exp(-dot(d, d) * 2.2); }
vec3 scene(vec2 p, float soft) {
  float vm = max(u_res.x, u_res.y);
  vec3 c = u_bg;
  c = mix(c, u_g1, u_ga * blob(p, vec2(0.12 * vm, 0.06 * vm), 0.30 * vm));
  c = mix(c, u_g2, u_ga * 0.9 * blob(p, vec2(u_res.x - 0.06 * vm, 0.3 * u_res.y + 0.12 * vm), 0.24 * vm));
  c = mix(c, u_g3, u_ga * 0.85 * blob(p, vec2(0.34 * u_res.x + 0.1 * vm, u_res.y), 0.22 * vm));
  // A faint dot grid: the detail refraction bends at the rims. Blurred under glass it is its mean.
  vec2 q = mod(p, 24.0) - 12.0;
  float dotm = 1.0 - smoothstep(0.7, 1.6, length(q));
  return mix(c, u_fg, u_grid * mix(dotm, 0.012, soft));
}`;

const FS_BACK = `
precision highp float;
${SCENE}
uniform vec2 u_origin;
varying vec2 v_local;
uniform vec2 u_total;
void main() {
  vec2 p = u_origin + v_local + 0.5 * u_total;
  gl_FragColor = vec4(scene(p, 0.0), 1.0);
}`;

const FS_GLASS = `
precision highp float;
${SCENE}
uniform vec2 u_center, u_size;
uniform float u_radius, u_zr, u_light;
uniform vec3 u_tint;
uniform float u_tintA, u_refract, u_chroma, u_edgeHL, u_spec, u_fresnel, u_shadow;
varying vec2 v_local;

float rr(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + vec2(r); return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r; }
float bevel(float d, float z) { if (d <= 0.0) return 0.0; if (d >= z) return z; return sqrt(d * (2.0 * z - d)); }

void main() {
  vec2 h = u_size * 0.5;
  float r = min(u_radius, min(h.x, h.y));
  float sdf = rr(v_local, h, r);
  if (sdf > 0.0) {
    float d = max(rr(v_local - vec2(0.0, 6.0), h, r) - 1.0, 0.0);
    // Falls to zero before the canvas edge (PAD), so it never shows a clipped border.
    float a = (exp(-d * d / 140.0) * 0.7 + exp(-d * 0.35) * 0.3) * (1.0 - smoothstep(12.0, 21.0, d)) * u_shadow;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    return;
  }
  float mask = 1.0 - smoothstep(-1.5, 0.5, sdf);
  float inside = -sdf;
  float edge = smoothstep(min(h.x, h.y) * 0.35, 0.0, inside);
  float z = min(u_zr, min(h.x, h.y));
  float e = 2.0;
  float hc = bevel(inside, z);
  vec2 g = vec2(
    bevel(-rr(v_local + vec2(e, 0.0), h, r), z) - bevel(-rr(v_local - vec2(e, 0.0), h, r), z),
    bevel(-rr(v_local + vec2(0.0, e), h, r), z) - bevel(-rr(v_local - vec2(0.0, e), h, r), z)) / (2.0 * e);
  vec3 N = normalize(vec3(-g, 1.0));
  float depth = smoothstep(0.0, z, inside);

  // Biconvex refraction: entry + exit surfaces, plus a gentle pull toward the centre.
  float rp = 1.0 - 1.0 / 1.5;
  vec2 refr = (g * rp * (2.0 + hc / max(z, 1.0) * 0.5)) * u_refract * 30.0;
  refr += -v_local / max(h, vec2(1.0)) * u_refract * 4.0 * depth;
  vec2 p = u_center + v_local + refr;
  vec2 ca = N.xy * u_chroma * 36.0 * (edge * 0.7 + 0.3);
  float soft = 1.0 - edge;          // frosted centre, crisp bent rim
  vec3 col = vec3(scene(p + ca, soft).r, scene(p, soft).g, scene(p - ca, soft).b);

  col = mix(col, u_tint, u_tintA);

  // Highlights live on the bevel only (N.z = 1 in the flat centre gives none of these).
  float fres = pow(1.0 - N.z, 4.0) * u_fresnel;
  vec3 V = vec3(0.0, 0.0, 1.0);
  float s1 = pow(max(dot(N, normalize(normalize(vec3(-0.4, -0.7, 1.0)) + V)), 0.0), 90.0);
  float s2 = pow(max(dot(N, normalize(normalize(vec3(0.3, 0.5, 1.0)) + V)), 0.0), 50.0) * 0.3;
  float s4 = pow(max(dot(N, normalize(normalize(vec3(0.0, -0.9, 0.4)) + V)), 0.0), 160.0) * 0.18;
  float spec = (s1 + s2 + s4) * u_spec * (1.0 - depth * depth);
  float stroke = smoothstep(-2.5, -1.5, sdf) * (1.0 - smoothstep(-1.0, 0.0, sdf));
  stroke *= 0.35 + 0.65 * (0.5 - 0.5 * v_local.y / h.y);
  float glow = smoothstep(6.0, 0.0, inside) * 0.15 + edge * 0.08;
  vec3 hl = vec3(spec + (glow + stroke * 0.6) * u_edgeHL + fres * 0.18);
  // On light grounds a white rim vanishes; the lower stroke darkens instead, like a lens edge.
  vec3 fin = col + hl * (1.0 - u_light * 0.35);
  fin -= vec3(u_light * stroke * 0.10 * (0.5 + 0.5 * v_local.y / h.y));
  gl_FragColor = vec4(clamp(fin, 0.0, 1.0) * mask, mask);
}`;

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
interface Panel { el: HTMLElement; cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; key: string }

const PAD = 24;
const SKIP = "dialog, .menu, .listbox, .theme-menu, .appbar, .tabbar";
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/** "h s% l%" token → sRGB 0..1 (same maths as check-contrast). */
function rgb(token: string): [number, number, number] {
  const m = token.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return [0, 0, 0];
  const h = +m[1]!, s = +m[2]! / 100, l = +m[3]! / 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

export function startLiquidGlass(root: HTMLElement): (() => void) | null {
  const glc = document.createElement("canvas");
  const gl = glc.getContext("webgl", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  if (!gl) return null;
  const compile = (fs: string): Prog | null => {
    const mk = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const v = mk(gl.VERTEX_SHADER, VS), f = mk(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram()!; gl.attachShader(p, v); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, "a_pos"); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    const u: Prog["u"] = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i)!.name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  };
  const back = compile(FS_BACK), glass = compile(FS_GLASS);
  if (!back || !glass) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0, 0, 0, 0);

  const backCv = document.createElement("canvas");
  backCv.className = "lg-backdrop";
  backCv.setAttribute("aria-hidden", "true");
  const backCtx = backCv.getContext("2d")!;
  document.body.prepend(backCv);
  document.documentElement.classList.add("lg");

  let theme = "", vw = 0, vh = 0, raf = 0, awakeUntil = 0, dead = false;
  let tokens: Record<string, number[] | number> = {};
  const panels = new Map<HTMLElement, Panel>();

  const readTheme = () => {
    tokens = {
      u_bg: rgb(css("--background")), u_g1: rgb(css("--glow")), u_g2: rgb(css("--glow-2")), u_g3: rgb(css("--glow-3")),
      u_fg: rgb(css("--foreground")), u_tint: rgb(css("--surface")),
      u_ga: Number(css("--glow-alpha")) || 0, u_grid: Number(css("--grid-alpha")) || 0, u_tintA: Number(css("--glass-alpha")) || 0.6,
      u_light: (document.documentElement.dataset.theme ?? "").endsWith("-light") ? 1 : 0,
    };
  };
  const setCommon = (pr: Prog) => {
    gl.useProgram(pr.p);
    for (const [k, v] of Object.entries(tokens)) {
      const loc = pr.u[k]; if (!loc) continue;
      if (typeof v === "number") gl.uniform1f(loc, v); else gl.uniform3fv(loc, v);
    }
    gl.uniform2f(pr.u.u_res!, vw, vh);
  };
  /** Draw into the bottom-left w×h of the shared GL canvas, growing it if needed. */
  const target = (w: number, h: number) => {
    if (glc.width < w || glc.height < h) { glc.width = Math.max(glc.width, w); glc.height = Math.max(glc.height, h); }
    gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const drawBackdrop = () => {
    const s = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(vw, vh));
    const w = Math.round(vw * s), h = Math.round(vh * s);
    target(w, h);
    setCommon(back);
    gl.uniform2f(back.u.u_total!, vw, vh);
    gl.uniform2f(back.u.u_origin!, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    backCv.width = w; backCv.height = h;
    backCtx.drawImage(glc, 0, glc.height - h, w, h, 0, 0, w, h);
  };

  const eligible = (el: HTMLElement) => !el.parentElement?.closest(".glass") && !el.closest(SKIP);
  const drawPanel = (el: HTMLElement, r: DOMRect, key: string) => {
    let pn = panels.get(el);
    if (!pn) {
      const cv = document.createElement("canvas");
      cv.className = "lg-panel"; cv.setAttribute("aria-hidden", "true");
      el.prepend(cv);
      pn = { el, cv, ctx: cv.getContext("2d")!, key: "" };
      panels.set(el, pn);
    }
    const tw = r.width + PAD * 2, th = r.height + PAD * 2;
    let s = Math.min(window.devicePixelRatio || 1, 2);
    if (tw * th * s * s > 2.5e6) s = Math.max(1, Math.sqrt(2.5e6 / (tw * th)));
    s = Math.min(s, 4096 / Math.max(tw, th));
    const w = Math.round(tw * s), h = Math.round(th * s);
    target(w, h);
    setCommon(glass);
    const u = glass.u;
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 20;
    const big = Math.min(r.width, r.height);
    gl.uniform2f(u.u_total!, tw, th);
    gl.uniform2f(u.u_center!, r.left + r.width / 2, r.top + r.height / 2);
    gl.uniform2f(u.u_size!, r.width, r.height);
    gl.uniform1f(u.u_radius!, radius);
    gl.uniform1f(u.u_zr!, Math.min(radius * 0.9, 24));
    gl.uniform1f(u.u_refract!, big > 160 ? 0.75 : 0.55);
    gl.uniform1f(u.u_chroma!, 0.08);
    gl.uniform1f(u.u_edgeHL!, 0.7);
    gl.uniform1f(u.u_spec!, 0.45);
    gl.uniform1f(u.u_fresnel!, 1);
    gl.uniform1f(u.u_shadow!, tokens.u_light ? 0.16 : 0.4);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (pn.cv.width !== w || pn.cv.height !== h) { pn.cv.width = w; pn.cv.height = h; }
    else pn.ctx.clearRect(0, 0, w, h);
    pn.ctx.drawImage(glc, 0, glc.height - h, w, h, 0, 0, w, h);
    pn.key = key;
    el.dataset.lg = "";
  };
  const release = (pn: Panel) => { pn.cv.remove(); delete pn.el.dataset.lg; panels.delete(pn.el); };

  const frame = () => {
    raf = 0;
    if (dead) return;
    const t = (document.documentElement.dataset.theme ?? "") + css("--glow-alpha");
    let all = false;
    if (t !== theme) { theme = t; readTheme(); all = true; }
    if (window.innerWidth !== vw || window.innerHeight !== vh) { vw = window.innerWidth; vh = window.innerHeight; all = true; }
    if (all) drawBackdrop();
    const seen = new Set<HTMLElement>();
    for (const el of root.querySelectorAll<HTMLElement>(".glass")) {
      if (!eligible(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.bottom < -vh * 1.5 || r.top > vh * 2.5) continue;          // far away: free the canvas
      seen.add(el);
      if (r.bottom < -PAD || r.top > vh + PAD) continue;                // near: keep, but don't draw
      const key = `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`;
      const pn = panels.get(el);
      if (all || !pn || pn.key !== key) drawPanel(el, r, key);
    }
    for (const pn of [...panels.values()]) if (!seen.has(pn.el) || !pn.el.isConnected) release(pn);
    if (performance.now() < awakeUntil) raf = requestAnimationFrame(frame);
  };
  // Only runs while something can move: scroll, resize, input, DOM or animation changes.
  const wake = () => { awakeUntil = performance.now() + 900; if (!raf && !dead) raf = requestAnimationFrame(frame); };
  const opts = { passive: true, capture: true } as const;
  const evs = ["scroll", "resize", "pointermove", "pointerdown", "keydown", "transitionrun", "animationstart", "toggle"];
  for (const e of evs) window.addEventListener(e, wake, opts);
  const mo = new MutationObserver(wake);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "open", "hidden"], childList: true, subtree: true });
  const ro = new ResizeObserver(wake); ro.observe(root);

  const stop = () => {
    if (dead) return;
    dead = true;
    cancelAnimationFrame(raf);
    for (const e of evs) window.removeEventListener(e, wake, opts);
    mo.disconnect(); ro.disconnect();
    for (const pn of [...panels.values()]) release(pn);
    backCv.remove();
    document.documentElement.classList.remove("lg");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  glc.addEventListener("webglcontextlost", stop);
  wake();
  return stop;
}
