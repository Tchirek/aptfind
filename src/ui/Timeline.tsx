import { formatClock } from '../app/format';
import { LIT, type Span, type SunPath } from '../engine/sunlight';
import { SPAN_COLOR } from './palette';

const W = 300;
const H = 26;

interface MergedSpan {
  from: number;
  to: number;
  lit: boolean;
  focusBuilding: number | null;
}

function mergeSpans(spans: Span[]): MergedSpan[] {
  const result: MergedSpan[] = [];
  for (const s of spans) {
    const lit = s.state === LIT;
    const focus = s.state >= 0 ? s.state : null;
    const prev = result[result.length - 1];
    if (prev && prev.lit === lit) {
      prev.to = s.to;
      if (prev.focusBuilding !== focus) prev.focusBuilding = null;
    } else {
      result.push({ from: s.from, to: s.to, lit, focusBuilding: focus });
    }
  }
  return result;
}

/** 日照时段条：有日照 / 无日照 */
export function Timeline({
  spans,
  path,
  onFocus,
}: {
  spans: Span[];
  path: SunPath;
  onFocus: (building: number | null) => void;
}) {
  const { startTst, endTst } = path.day;
  const x = (t: number) => ((t - startTst) / (endTst - startTst)) * W;
  const hours: number[] = [];
  for (let h = Math.ceil(startTst / 60); h <= Math.floor(endTst / 60); h++) hours.push(h);

  const merged = mergeSpans(spans);

  return (
    <figure className="timeline">
      <svg viewBox={`-16 -14 ${W + 32} ${H + 30}`} width="100%" role="img" aria-label="日照时段">
        {hours.map((h) => (
          <text key={`t${h}`} x={x(h * 60)} y={-4} className="tick" textAnchor="middle">
            {h}
          </text>
        ))}
        {merged.map((s) => {
          const color = s.lit ? SPAN_COLOR.lit : SPAN_COLOR.unlit;
          const canFocus = s.focusBuilding !== null;
          return (
            <rect
              key={`${s.from}`}
              x={x(s.from)}
              y={0}
              width={Math.max(0.5, x(s.to) - x(s.from) - 1)}
              height={H}
              rx={2}
              fill={color}
              onPointerEnter={canFocus ? () => onFocus(s.focusBuilding) : undefined}
              onPointerLeave={canFocus ? () => onFocus(null) : undefined}
            >
              <title>
                {formatClock(path.beijingAt(s.from))}–{formatClock(path.beijingAt(s.to))}
                {s.lit ? ' 有日照' : ' 无日照'}
              </title>
            </rect>
          );
        })}
        {[startTst, (startTst + endTst) / 2, endTst].map((t) => (
          <text key={`b${t}`} x={x(t)} y={H + 14} className="tick muted" textAnchor="middle">
            {formatClock(path.beijingAt(t))}
          </text>
        ))}
      </svg>
      <figcaption>
        <span>
          <i style={{ background: SPAN_COLOR.lit }} />
          有日照
        </span>
        <span>
          <i style={{ background: SPAN_COLOR.unlit }} />
          无日照
        </span>
      </figcaption>
    </figure>
  );
}
