import { HOUR_BINS, THRESHOLD_MINUTES } from './palette';

const fmt = (m: number) => (m === 0 ? '0' : `${m / 60}`);

export function Legend() {
  return (
    <figure className="panel legend" aria-label="日照时数图例">
      <figcaption>大寒日日照（小时）</figcaption>
      <div className="swatches">
        {HOUR_BINS.map((b) => (
          <div
            key={b.from}
            className={b.from === THRESHOLD_MINUTES ? 'swatch threshold' : 'swatch'}
          >
            <i style={{ background: b.color }} />
            <span>{fmt(b.from)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
