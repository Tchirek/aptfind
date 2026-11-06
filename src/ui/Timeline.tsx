import { formatClock } from '../app/format';
import { AWAY, LIT, type Span, type SunPath } from '../engine/sunlight';
import { SPAN_COLOR } from './palette';

const W = 300;
const H = 26;

/** 一天的照到/被挡/背光时段条：上方刻度为真太阳时，下方为北京时间 */
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

  return (
    <figure className="timeline">
      <svg viewBox={`-16 -14 ${W + 32} ${H + 30}`} width="100%" role="img" aria-label="日照时段">
        {hours.map((h) => (
          <text key={`t${h}`} x={x(h * 60)} y={-4} className="tick" textAnchor="middle">
            {h}
          </text>
        ))}
        {spans.map((s) => {
          const color =
            s.state === LIT
              ? SPAN_COLOR.lit
              : s.state === AWAY
                ? SPAN_COLOR.away
                : SPAN_COLOR.blocked;
          const blocker = s.state >= 0;
          return (
            <rect
              key={`${s.from}`}
              x={x(s.from)}
              y={0}
              width={Math.max(0.5, x(s.to) - x(s.from) - 1)}
              height={H}
              rx={2}
              fill={color}
              onPointerEnter={blocker ? () => onFocus(s.state) : undefined}
              onPointerLeave={blocker ? () => onFocus(null) : undefined}
            >
              <title>
                {formatClock(path.beijingAt(s.from))}–{formatClock(path.beijingAt(s.to))}
                {s.state === LIT ? ' 照到' : s.state === AWAY ? ' 太阳在墙背面' : ' 被挡'}
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
          照到
        </span>
        <span>
          <i style={{ background: SPAN_COLOR.blocked }} />
          被挡
        </span>
        <span>
          <i style={{ background: SPAN_COLOR.away }} />
          太阳在墙背面
        </span>
        <span className="muted">上：真太阳时 · 下：北京时间</span>
      </figcaption>
    </figure>
  );
}
