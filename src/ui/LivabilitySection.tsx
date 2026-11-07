import { useApp } from '../app/store';

/** 选中楼的宜居评分：总分、逐项贡献（带依据）与扣分项 */
export function LivabilitySection({ building }: { building: number }) {
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
      <p className="liv-note">按日照、步行、视野、地形与楼龄的固定规则算出，不含主观判断。</p>
    </section>
  );
}
