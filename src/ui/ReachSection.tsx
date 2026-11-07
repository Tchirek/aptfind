import { type CSSProperties, useState } from 'react';
import type { ReachStation } from '../app/reach.worker';
import { useApp } from '../app/store';
import './reach-section.css';

function formatArea(sqMeters: number): string {
  const sqKm = sqMeters / 1_000_000;
  return `${sqKm.toFixed(1)} km²`;
}

const routeKey = (s: ReachStation) => s.lines.map((l) => l.name).join('>');

/**
 * 同一乘车方案（同一条线、或同样的换乘顺序）的站排在一起；
 * 先按首乘线路最近的一站排组，再按整条方案最近的一站，组内按时间
 */
export function groupByRoute(stations: readonly ReachStation[]): ReachStation[] {
  const firstBest = new Map<string, number>();
  const routeBest = new Map<string, number>();
  for (const s of stations) {
    const f = s.lines[0]?.name ?? '';
    const r = routeKey(s);
    firstBest.set(f, Math.min(firstBest.get(f) ?? Number.POSITIVE_INFINITY, s.exit));
    routeBest.set(r, Math.min(routeBest.get(r) ?? Number.POSITIVE_INFINITY, s.exit));
  }
  const rank = (s: ReachStation) =>
    [firstBest.get(s.lines[0]?.name ?? '') ?? 0, routeBest.get(routeKey(s)) ?? 0, s.exit] as const;
  return [...stations].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });
}

/** 外框取所乘线路的标志色；换乘就按顺序分段 */
function tagStyle(s: ReachStation): CSSProperties {
  const cs = s.lines.map((l) => l.colour);
  if (cs.length === 0) return {};
  if (cs.length === 1) return { borderColor: cs[0] };
  const stops = cs
    .map((c, i) => `${c} ${(i / cs.length) * 100}% ${((i + 1) / cs.length) * 100}%`)
    .join(', ');
  return {
    borderColor: 'transparent',
    background: `linear-gradient(var(--panel), var(--panel)) padding-box, linear-gradient(90deg, ${stops}) border-box`,
  };
}

export function ReachSection({ building }: { building: number }) {
  const reach = useApp((s) => s.reach);
  const requestFly = useApp((s) => s.requestFly);
  const [expanded, setExpanded] = useState(false);

  if (!reach || reach.building !== building) {
    return (
      <section>
        <div className="label">可达范围</div>
        <div className="reach-loading muted">…</div>
      </section>
    );
  }

  const { area15, area30, stations, far } = reach;
  // 收起时只看最近的 6 站（stations 已按出站时间排好），再按线路归组
  const visibleStations = groupByRoute(expanded ? stations : stations.slice(0, 6));
  const hasMore = stations.length > 6;

  const handleFly = () => {
    if (!far) return;
    const { x0, y0, cell, nx, ny } = far.grid;
    const cx = x0 + (nx * cell) / 2;
    const cy = y0 + (ny * cell) / 2;
    const side = Math.max(nx, ny) * cell;
    requestFly([cx, cy, 0], side * 1.15);
  };

  return (
    <section>
      <div className="label">可达范围</div>
      <div className="reach-legend">
        <div className="reach-legend-row">
          <span className="reach-swatch" style={{ background: '#3fada4' }} />
          <span className="reach-name">15 分钟步行</span>
          <span className="reach-area mono">{formatArea(area15)}</span>
        </div>
        <div className="reach-legend-row">
          <span className="reach-swatch" style={{ background: '#73bfc5' }} />
          <span className="reach-name">30 分钟 · 步行 + 地铁</span>
          <span className="reach-area mono">{formatArea(area30)}</span>
        </div>
      </div>
      {stations.length > 0 && (
        <ul className="reach-stations">
          {visibleStations.map((s) => (
            <li
              key={s.name}
              className="reach-station-tag"
              style={tagStyle(s)}
              title={s.lines.map((l) => l.name).join(' → ')}
            >
              {s.name} {Math.round(s.exit)} 分
            </li>
          ))}
          {hasMore && (
            <li>
              <button type="button" className="reach-toggle" onClick={() => setExpanded((v) => !v)}>
                {expanded ? '收起' : `全部 ${stations.length} 站`}
              </button>
            </li>
          )}
        </ul>
      )}
      {far && (
        <div className="reach-footer">
          <button type="button" className="reach-text-btn" onClick={handleFly}>
            看全图
          </button>
        </div>
      )}
    </section>
  );
}
