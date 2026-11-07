/**
 * 地价：官方基准地价 + 本地成交价。
 *
 * 成都市中心城区住宅用地基准地价（楼面地价、容积率 2.0，2024-12-01 起执行）：
 * Ⅰ 13400、Ⅱ 11100、Ⅲ 8750、Ⅳ 6900、Ⅴ 4960、Ⅵ 3350 元/㎡。
 * 狮子山片区在级别图上跨Ⅱ、Ⅲ级一带，所以给区间而不是单值。
 *
 * 本地成交：四川师大站 TOD 两宗地 2020-11 成交楼面价 6400、9100 元/㎡。
 * 成交价受地块条件、配建与市场行情影响，与基准地价不是一回事。
 */

const GRADES = [
  { grade: 'Ⅰ', price: 13400 },
  { grade: 'Ⅱ', price: 11100 },
  { grade: 'Ⅲ', price: 8750 },
  { grade: 'Ⅳ', price: 6900 },
  { grade: 'Ⅴ', price: 4960 },
  { grade: 'Ⅵ', price: 3350 },
] as const;

/** 片区所在的级别区间（2024 版级别图） */
const LOCAL = new Set(['Ⅱ', 'Ⅲ']);

const TOD_DEALS = [
  { name: '一号地块', price: 6400 },
  { name: '二号地块', price: 9100 },
] as const;

const fmt = (v: number) => v.toLocaleString('zh-CN');

export function LandPriceSection() {
  const max = GRADES[0].price;
  return (
    <section>
      <div className="label">地价</div>
      <div className="price-head">
        <span className="price-value mono">8,750–11,100</span>
        <span className="price-unit">元/㎡ 楼面价</span>
      </div>
      <p className="price-sub">Ⅱ–Ⅲ 级基准地价 · 2024 年成都市中心城区</p>
      <ul className="price-scale" aria-label="住宅用地基准地价（元/平方米）">
        {GRADES.map((g) => {
          const on = LOCAL.has(g.grade);
          return (
            <li key={g.grade} className={on ? 'on' : ''}>
              <span className="price-bar" aria-hidden>
                <i style={{ height: `${(g.price / max) * 100}%` }} />
              </span>
              <span className="price-grade">{g.grade}</span>
              <span className="price-num mono">{fmt(g.price)}</span>
            </li>
          );
        })}
      </ul>
      <p className="price-note">
        本地成交：四川师大站 TOD {TOD_DEALS.map((d) => `${d.name} ${fmt(d.price)}`).join(' / ')}{' '}
        元/㎡（2020-11）
      </p>
    </section>
  );
}
