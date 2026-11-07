import { useApp } from '../app/store';
import { ROOF_COLORS, roofColorOf } from '../scene/buildingGeometry';

/** 屋顶色的图例：五档色带，标出这栋楼落在哪 */
function RoofKey({ score, stops }: { score: number; stops: readonly number[] }) {
  const lo = stops[0] as number;
  const hi = stops[stops.length - 1] as number;
  const pos = Math.min(1, Math.max(0, (score - lo) / Math.max(1, hi - lo)));
  // 色带上各档按分数等距排开，与屋顶的插值一致
  const grad = ROOF_COLORS.map(
    (c, i) => `${c} ${(((stops[i] as number) - lo) / Math.max(1, hi - lo)) * 100}%`,
  ).join(', ');
  return (
    <div className="liv-key">
      <span className="liv-key-label">屋顶色</span>
      <span className="liv-key-bar" style={{ background: `linear-gradient(90deg, ${grad})` }}>
        <i
          style={{
            left: `${pos * 100}%`,
            background: `#${roofColorOf(score, stops).getHexString()}`,
          }}
        />
      </span>
      <span className="liv-key-ends mono">
        {lo}–{hi}
      </span>
    </div>
  );
}

/** 选中楼的宜居评分：总分、逐项贡献（带依据）与扣分项；有屋顶色阶时附上图例 */
export function LivabilitySection({
  building,
  roofStops,
}: {
  building: number;
  /** 这栋楼的屋顶按评分着色时传入色阶节点 */
  roofStops?: readonly number[];
}) {
  const livability = useApp((s) => s.livability);
  const mine = livability?.building === building ? livability : null;

  if (!mine) {
    return (
      <section>
        <div className="label">宜居评分</div>
        <div className="liv-loading muted">计算中…</div>
      </section>
    );
  }

  return (
    <section>
      <div className="label">宜居评分</div>
      <div className="liv-top">
        <span className="liv-score mono">{mine.total}</span>
        <span className={`liv-grade ${mine.tone}`}>{mine.label}</span>
        <span className="liv-sum">{mine.summary}</span>
      </div>
      {roofStops && <RoofKey score={mine.total} stops={roofStops} />}
      <ul className="liv-dims">
        {mine.dimensions.map((d) => (
          <li key={d.key}>
            <span className="liv-name">{d.label}</span>
            <span className="liv-bar" aria-hidden>
              <i style={{ width: `${Math.round((d.score / d.max) * 100)}%` }} />
            </span>
            <span className="liv-pts mono">
              {Math.round(d.score)}
              <small>/{d.max}</small>
            </span>
            <span className="liv-detail">{d.detail}</span>
          </li>
        ))}
      </ul>
      {mine.penalties.length > 0 && (
        <ul className="liv-pen">
          {mine.penalties.map((p) => (
            <li key={p.label}>
              <span>{p.label}</span>
              <span className="mono">−{Math.round(p.points * 10) / 10}</span>
              <span className="liv-detail">{p.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
