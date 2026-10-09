// Hand-built SVG bell curve replacing Chart.js (~70 KB gz). The pin is a
// keyboard-operable slider as well as a drag target; every colour is a token.
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import calc from "../../content/calculator.json";
import { MAX_AGGREGATE, aggregateToAtar, density, fmt } from "../lib/engine.ts";
import { useSpring } from "../lib/motion.ts";
import { useCalc } from "../lib/state.tsx";
import { t } from "../lib/text.ts";

const W = 640, H = 250, L = 18, R = 18, T = 22, B = 44;
const x = (agg: number) => L + (agg / MAX_AGGREGATE) * (W - L - R);
const y = (d: number) => T + (1 - d) * (H - T - B);

// Rubber-banding (Apple, Designing Fluid Interfaces): past what the ticked subjects
// can reach, the pin follows with growing resistance instead of stopping dead.
const BAND = MAX_AGGREGATE * 0.12;
const rubber = (o: number) => (o * BAND * 0.55) / (BAND + 0.55 * Math.abs(o));
const soft = (v: number, lo: number, hi: number) => (v > hi ? hi + rubber(v - hi) : v < lo ? lo - rubber(lo - v) : v);
const clampAgg = (v: number) => Math.max(0, Math.min(MAX_AGGREGATE, v));

export function CurveChart({ expected, target }: { expected: number | null; target: number | null }) {
  const { c, beginDrag, driveTo, endDrag, setAggregate } = useCalc();
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const has = c.counted.length > 0;
  const agg = c.aggregate;
  // While dragging the pin is glued to the pointer (dragAt, rubber-banded at the
  // limits); on release a critically damped spring takes it to the real aggregate,
  // starting from where it is and at the pointer's release velocity.
  const [dragAt, setDragAt] = useState<number | null>(null);
  const [at, pin] = useSpring(dragAt ?? agg, 0.35);
  const [expEased] = useSpring(expected ?? 0, 0.4), [tgtEased] = useSpring(target ?? 0, 0.4);
  const g = useRef({ offset: 0, lo: 0, hi: MAX_AGGREGATE, hist: [] as { t: number; x: number }[] });
  const velocity = () => {
    const h = g.current.hist, a = h[0], b = h[h.length - 1];
    return a && b && b.t - a.t > 8 ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0;
  };

  const curve = useMemo(() => {
    const pts: string[] = [];
    for (let a = 0; a <= MAX_AGGREGATE; a += 4) pts.push(`${x(a).toFixed(1)},${y(density(a)).toFixed(1)}`);
    return { line: `M${pts.join("L")}`, fill: `M${x(0)},${y(0)}L${pts.join("L")}L${x(MAX_AGGREGATE)},${y(0)}Z` };
  }, []);
  const shade = useMemo(() => {
    if (!has) return "";
    const pts: string[] = [];
    for (let a = 0; a <= at; a += 4) pts.push(`${x(a).toFixed(1)},${y(density(a)).toFixed(1)}`);
    pts.push(`${x(at).toFixed(1)},${y(density(at)).toFixed(1)}`);
    return `M${x(0)},${y(0)}L${pts.join("L")}L${x(at)},${y(0)}Z`;
  }, [at, has]);

  /** Pointer position in aggregate units — unclamped, so the rubber band can see past the ends. */
  const rawAgg = (e: PointerEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect();
    return ((((e.clientX - r.left) / r.width) * W - L) / (W - L - R)) * MAX_AGGREGATE;
  };
  const track = (want: number, now: number) => {
    const r = driveTo(clampAgg(want));
    const lo = Math.max(0, r?.lo ?? 0), hi = Math.min(MAX_AGGREGATE, r?.hi ?? MAX_AGGREGATE);
    const shown = soft(want, lo, hi);
    const h = g.current.hist;
    h.push({ t: now, x: shown });
    while (h.length > 2 && now - h[0]!.t > 90) h.shift();
    setDragAt(shown);
    pin.jump(shown, velocity());
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (!has || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const raw = rawAgg(e);
    // Grabbed the pin itself? Keep the offset from where it was grabbed instead of snapping its centre.
    const pxPerAgg = svg.current!.getBoundingClientRect().width / W * ((W - L - R) / MAX_AGGREGATE);
    g.current.offset = Math.abs(raw - at) * pxPerAgg < 18 ? at - raw : 0;
    g.current.hist = [];
    setDragging(true); beginDrag();
    track(raw + g.current.offset, e.timeStamp);
  };
  const moveTo = (e: PointerEvent<SVGSVGElement>) => { if (dragging) track(rawAgg(e) + g.current.offset, e.timeStamp); };
  const up = () => {
    if (!dragging) return;
    pin.jump(at, velocity());   // hand the release velocity to the spring
    setDragAt(null); setDragging(false); endDrag();
  };

  const key = (e: KeyboardEvent<SVGGElement>) => {
    const big = e.shiftKey ? 10 : 1;
    const next = ({ ArrowRight: agg + big, ArrowUp: agg + big, ArrowLeft: agg - big, ArrowDown: agg - big, PageUp: agg + 10, PageDown: agg - 10, Home: 0, End: MAX_AGGREGATE } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setAggregate(Math.max(0, Math.min(MAX_AGGREGATE, next)));
  };

  const marker = (a: number | null, cls: string, label: string) =>
    a === null ? null : (
      <g aria-hidden="true">
        <circle className={cls} cx={x(a)} cy={y(density(a))} r={6.5} />
        <text className="marker-label" x={x(a)} y={y(density(a)) - 11} textAnchor="middle">{label}</text>
      </g>
    );

  return (
    <svg
      ref={svg} viewBox={`0 0 ${W} ${H}`} className="chart" role="group" aria-label={calc.curve.chartLabel}
      data-dragging={dragging} onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={up}
    >
      <defs aria-hidden="true">
        <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="g-top" /><stop offset="1" className="g-bottom" /></linearGradient>
      </defs>
      {[0, 100, 200, 300, 400, 500].map((a) => (
        <g key={a} aria-hidden="true">
          <line className="gridline" x1={x(a)} x2={x(a)} y1={T - 8} y2={y(0)} />
          <text className="tick" x={x(a)} y={y(0) + 18} textAnchor="middle">{a}</text>
        </g>
      ))}
      <text className="axis-title" x={W / 2} y={H - 4} textAnchor="middle" aria-hidden="true">{calc.curve.axis}</text>
      <path className="curve-fill" d={curve.fill} aria-hidden="true" />
      {has && <path className="shade" d={shade} aria-hidden="true" />}
      <path className="curve-line" d={curve.line} aria-hidden="true" />
      {marker(expected === null ? null : expEased, "m-expected", calc.curve.legend.expected)}
      {marker(target === null ? null : tgtEased, "m-target", calc.curve.legend.target)}
      {has && (
        <g
          className="pin-group" tabIndex={0} role="slider" aria-label={calc.curve.pinLabel}
          aria-valuemin={0} aria-valuemax={MAX_AGGREGATE} aria-valuenow={Math.round(agg * 10) / 10}
          aria-valuetext={t(calc.curve.pinValueText, { agg: fmt(agg), atar: fmt(aggregateToAtar(agg), 2) })}
          onKeyDown={key}
        >
          <line className="pin-stem" x1={x(at)} x2={x(at)} y1={y(density(at))} y2={y(0)} />
          <g transform={`translate(${x(at).toFixed(2)} ${y(density(at)).toFixed(2)})`}>
            <circle className="pin-halo" r={dragging ? 22 : 17} />
            <circle className="pin" r={dragging ? 11 : 10} />
          </g>
        </g>
      )}
    </svg>
  );
}
