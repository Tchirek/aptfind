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
  now,
  onFocus,
}: {
  spans: Span[];
  path: SunPath;
  /** 场景当前时刻（北京时间分钟），落在这一天的日照时段内时画一道竖线 */
  now?: number;
  onFocus: (building: number | null) => void;
}) {
  const { startTst, endTst } = path.day;
  const x = (t: number) => ((t - startTst) / (endTst - startTst)) * W;
  // 刻度只标北京时间的整点：真太阳时与北京时间在一天内近似平移，按两端线性换算位置
  const bjStart = path.beijingAt(startTst);
  const bjEnd = path.beijingAt(endTst);
  const xBj = (bj: number) => ((bj - bjStart) / (bjEnd - bjStart)) * W;
  const hours: number[] = [];
  for (let h = Math.ceil(bjStart / 60); h <= Math.floor(bjEnd / 60); h++) hours.push(h);

  const merged = mergeSpans(spans);

  return (
    <figure className="timeline">
      <svg viewBox={`-16 -14 ${W + 32} ${H + 16}`} width="100%" role="img" aria-label="日照时段">
        {hours.map((h) => (
          <text key={`t${h}`} x={xBj(h * 60)} y={-4} className="tick" textAnchor="middle">
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
        {now !== undefined && now >= bjStart && now <= bjEnd && (
          <line className="now" x1={xBj(now)} x2={xBj(now)} y1={-2} y2={H + 2} />
        )}
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
