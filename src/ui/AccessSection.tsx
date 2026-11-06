import { useEffect, useState } from 'react';
import { getWalk } from '../app/data';
import { useApp } from '../app/store';
import type { PoiCategory } from '../engine/district';
import { type Access, accessFrom, minutesOf, type WalkGraph } from '../engine/walk';

interface Row {
  category: PoiCategory;
  label: string;
  /** 只报 10 分钟内的数量，不报最近一处 */
  countOnly?: boolean;
}

const ROWS: Row[] = [
  { category: 'metro', label: '地铁' },
  { category: 'bus', label: '公交' },
  { category: 'grocery', label: '超市便利' },
  { category: 'market', label: '菜市场' },
  { category: 'food', label: '餐饮', countOnly: true },
  { category: 'medical', label: '医疗' },
  { category: 'park', label: '公园' },
];

/** '狮子山地铁站B口' → '狮子山站 B口'，'四川师大(地铁站)' → '四川师大站' */
export function shortPoiName(name: string): string {
  const m = name.match(/^(.+?)(?:地铁站|\(地铁站\)|（地铁站）)(.*)$/);
  if (m) return `${m[1]}站${m[2] ? ` ${m[2]}` : ''}`;
  return name;
}

const fmtMinutes = (meters: number) => `${Math.max(1, Math.round(minutesOf(meters)))} 分钟`;

/** 从 (x, y) 步行到各类设施：最近一处与用时；点一行在地图上画出路线 */
export function AccessSection({ x, y }: { x: number; y: number }) {
  const setRoute = useApp((s) => s.setRoute);
  const [state, setState] = useState<{ access: Access; graph: WalkGraph } | null>(null);
  const [active, setActive] = useState<PoiCategory>('metro');

  useEffect(() => {
    let alive = true;
    setState(null);
    getWalk().then(({ graph, pois }) => {
      if (!alive) return;
      setState({ access: accessFrom(graph, pois, x, y, 2000), graph });
    });
    return () => {
      alive = false;
    };
  }, [x, y]);

  useEffect(() => {
    if (!state) return;
    const c = state.access.categories.find((k) => k.category === active);
    const p = c?.nearest;
    if (!p || !Number.isFinite(c.meters)) {
      setRoute(null);
      return;
    }
    const path = state.graph.route(state.access.paths, p.node);
    const points = new Float64Array(path.length + 4);
    points.set([x, y], 0);
    points.set(path, 2);
    points.set([p.poi.x, p.poi.y], path.length + 2);
    setRoute({ points, label: shortPoiName(p.poi.name) });
  }, [state, active, x, y, setRoute]);

  useEffect(() => () => setRoute(null), [setRoute]);

  return (
    <section>
      <div className="label">步行可达</div>
      <ul className="access">
        {ROWS.map((row) => {
          const c = state?.access.categories.find((k) => k.category === row.category);
          const reachable = c?.nearest && Number.isFinite(c.meters);
          return (
            <li key={row.category} className={row.category === active ? 'on' : ''}>
              <button type="button" onClick={() => setActive(row.category)} disabled={!reachable}>
                <span className="access-kind">{row.label}</span>
                <span className="access-name">
                  {!state
                    ? '…'
                    : !reachable
                      ? '2 公里内没有'
                      : row.countOnly
                        ? `10 分钟内 ${c.within10} 家`
                        : shortPoiName(c.nearest?.poi.name ?? '')}
                </span>
                <span className="access-time mono">
                  {reachable && !row.countOnly ? fmtMinutes(c.meters) : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
