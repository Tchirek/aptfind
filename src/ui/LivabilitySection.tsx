import { useApp } from '../app/store';
import type { Fact } from '../engine/livability';

/** 依据排成四列小格：上面是短标签，下面是数值，各维度之间上下对齐 */
function Facts({ facts }: { facts: Fact[] }) {
  return (
    <dl className="liv-facts">
      {facts.map((f) => (
        <div key={f.label} className={f.wide ? 'wide' : undefined}>
          <dt>{f.label}</dt>
          <dd className="mono">
            {f.value.startsWith('~') ? (
              <>
                <span className="approx">~</span>
                {f.value.slice(1)}
              </>
            ) : (
              f.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

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
            <Facts facts={d.facts} />
          </li>
        ))}
      </ul>
      {mine.penalties.length > 0 && (
        <ul className="liv-pen">
          {mine.penalties.map((p) => (
            <li key={p.label}>
              <span className="liv-name">{p.label}</span>
              <span />
              <span className="liv-pts mono">−{Math.round(p.points * 10) / 10}</span>
              <Facts facts={p.facts} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
