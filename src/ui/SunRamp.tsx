import { COOL_RAMP, THRESHOLD_MINUTES, WARM_RAMP } from './palette';

/**
 * 外墙着色的色带：0 到 2 小时蓝，2 小时以上金到琥珀，跨度随当天昼长。
 * 刻度每 2 小时一个，2 小时处一道深色竖线，与外墙上的粗等时线对应。
 */
export function SunRamp({ warmSpan }: { warmSpan: number }) {
  const total = THRESHOLD_MINUTES + warmSpan;
  const pct = (m: number) => `${(m / total) * 100}%`;
  const ticks: number[] = [];
  for (let m = 0; m <= total + 1; m += 120) ticks.push(m);
  const cool = `linear-gradient(to right, ${COOL_RAMP.join(', ')})`;
  const warm = `linear-gradient(to right, ${WARM_RAMP.join(', ')})`;
  return (
    <figure className="sun-ramp" aria-label="外墙颜色对应的日照时长">
      <div className="ramp">
        <i style={{ width: pct(THRESHOLD_MINUTES), background: cool }} />
        <i style={{ width: pct(warmSpan), background: warm }} />
        <b style={{ left: pct(THRESHOLD_MINUTES) }} />
      </div>
      <div className="ramp-ticks">
        {ticks.map((m) => (
          <span key={m} style={{ left: pct(m) }}>
            {m / 60}
          </span>
        ))}
        <em>小时</em>
      </div>
    </figure>
  );
}
