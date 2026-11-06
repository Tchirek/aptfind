import { COOL_RAMP, THRESHOLD_MINUTES, WARM_RAMP, WARM_SPAN } from './palette';

const TOTAL = THRESHOLD_MINUTES + WARM_SPAN;
const TICKS = [0, 60, 120, 240, 360];
const pct = (m: number) => `${(m / TOTAL) * 100}%`;

export function Legend() {
  const cool = `linear-gradient(to right, ${COOL_RAMP.join(', ')})`;
  const warm = `linear-gradient(to right, ${WARM_RAMP.join(', ')})`;
  return (
    <figure className="panel legend" aria-label="大寒日日照时数图例">
      <figcaption>大寒日日照</figcaption>
      <div className="ramp">
        <i style={{ width: pct(THRESHOLD_MINUTES), background: cool }} />
        <i style={{ width: pct(WARM_SPAN), background: warm }} />
        <b style={{ left: pct(THRESHOLD_MINUTES) }} />
      </div>
      <div className="ramp-ticks">
        {TICKS.map((m) => (
          <span key={m} style={{ left: pct(m) }}>
            {m === TOTAL ? '6+' : m / 60}
          </span>
        ))}
        <em>小时</em>
      </div>
    </figure>
  );
}
