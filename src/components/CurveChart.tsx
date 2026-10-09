// Hand-built SVG bell curve replacing Chart.js (~70 KB gz). The pin is a
// keyboard-operable slider as well as a drag target; every colour is a token.
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import calc from "../../content/calculator.json";
import { MAX_AGGREGATE, aggregateToAtar, density, fmt } from "../lib/engine.ts";
import { useTween } from "../lib/motion.ts";
import { useCalc } from "../lib/state.tsx";
import { t } from "../lib/text.ts";

const W = 640, H = 250, L = 18, R = 18, T = 22, B = 44;
const x = (agg: number) => L + (agg / MAX_AGGREGATE) * (W - L - R);
const y = (d: number) => T + (1 - d) * (H - T - B);

export function CurveChart({ expected, target }: { expected: number | null; target: number | null }) {
  const { c, beginDrag, driveTo, endDrag, setAggregate } = useCalc();
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const has = c.counted.length > 0;
  const agg = c.aggregate;
  // Drawn position: follows the pointer exactly while dragging, eases otherwise.
  const eased = useTween(agg, 420);
  const at = dragging ? agg : eased;
  const expEased = useTween(expected ?? 0, 420), tgtEased = useTween(target ?? 0, 420);

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

  const aggFrom = (e: PointerEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(MAX_AGGREGATE, ((vx - L) / (W - L - R)) * MAX_AGGREGATE));
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (!has || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true); beginDrag(); driveTo(aggFrom(e));
  };
  const moveTo = (e: PointerEvent<SVGSVGElement>) => { if (dragging) driveTo(aggFrom(e)); };
  const up = () => { if (dragging) { setDragging(false); endDrag(); } };

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
          <circle className="pin-halo" cx={x(at)} cy={y(density(at))} r={dragging ? 22 : 17} />
          <circle className="pin" cx={x(at)} cy={y(density(at))} r={dragging ? 11 : 10} />
        </g>
      )}
    </svg>
  );
}
