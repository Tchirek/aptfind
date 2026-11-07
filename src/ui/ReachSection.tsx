import { useState } from 'react';
import { useApp } from '../app/store';
import './reach-section.css';

function formatArea(sqMeters: number): string {
  const sqKm = sqMeters / 1_000_000;
  return `${sqKm.toFixed(1)} km²`;
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
  const visibleStations = expanded ? stations : stations.slice(0, 6);
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
            <li key={s.name} className="reach-station-tag">
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
