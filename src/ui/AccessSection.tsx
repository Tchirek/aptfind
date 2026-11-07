import { useEffect, useState } from 'react';
import { getRegion } from '../app/data';
import { useApp } from '../app/store';
import type { PoiCategory } from '../engine/district';
import {
  type Access,
  accessFrom,
  buildingDoors,
  minutesOf,
  routeToPoi,
  type WalkGraph,
} from '../engine/walk';

interface Row {
  category: PoiCategory;
  label: string;
  /** 品牌徽标（public/brands/ 下） */
  logo?: string;
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
  { category: 'mcdonalds', label: '麦当劳', logo: 'mcdonalds' },
  { category: 'kfc', label: '肯德基', logo: 'kfc' },
  { category: 'starbucks', label: '星巴克', logo: 'starbucks' },
  { category: 'hema', label: '盒马', logo: 'hema' },
];

/** '麦当劳(华固一品店)' → '华固一品店'：品牌行已有徽标，只留分店名 */
const branchName = (name: string) => name.match(/[（(]([^）)]+)[）)]\s*$/)?.[1] ?? name;

/** '狮子山地铁站B口' → '狮子山站 B口'，'四川师大(地铁站)' → '四川师大站' */
export function shortPoiName(name: string): string {
  const m = name.match(/^(.+?)(?:地铁站|\(地铁站\)|（地铁站）)(.*)$/);
  if (m) return `${m[1]}站${m[2] ? ` ${m[2]}` : ''}`;
  return name;
}

const fmtMinutes = (meters: number) => `${Math.max(1, Math.round(minutesOf(meters)))} 分钟`;

/**
 * 从一栋楼（或一个地块）的外轮廓出发，步行到各类设施：最近一处与用时；点一行在地图上画出路线。
 * 路线从轮廓上离路最近的出入口画起，不会从楼中间穿出来。
 */
export function AccessSection({ ring }: { ring: Float64Array }) {
  const setRoute = useApp((s) => s.setRoute);
  const [state, setState] = useState<{ access: Access; graph: WalkGraph } | null>(null);
  const [active, setActive] = useState<PoiCategory>('metro');

  useEffect(() => {
    let alive = true;
    setState(null);
    getRegion().then(({ graph, pois }) => {
      if (!alive) return;
      setState({ access: accessFrom(graph, pois, buildingDoors(graph, ring), 3000), graph });
    });
    return () => {
      alive = false;
    };
  }, [ring]);

  useEffect(() => {
    if (!state) return;
    const c = state.access.categories.find((k) => k.category === active);
    const p = c?.nearest;
    if (!p || !Number.isFinite(c.meters)) {
      setRoute(null);
      return;
    }
    setRoute({ points: routeToPoi(state.graph, state.access, p), label: shortPoiName(p.poi.name) });
  }, [state, active, setRoute]);

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
                <span className="access-kind">
                  {row.logo && (
                    <img
                      className="brand-logo"
                      src={`${import.meta.env.BASE_URL}brands/${row.logo}.svg`}
                      alt=""
                    />
                  )}
                  {row.label}
                </span>
                <span className="access-name">
                  {!state
                    ? '…'
                    : !reachable
                      ? '3 公里内没有'
                      : row.countOnly
                        ? `10 分钟内 ${c.within10} 家`
                        : row.logo
                          ? branchName(c.nearest?.poi.name ?? '')
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
