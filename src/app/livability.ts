/**
 * 选中楼的宜居评分：在 Worker 之外的主线程上收集事实（日照、步行、视野、场地），
 * 交给纯函数 scoreLivability 算分，结果写进 store.livability。
 */

import { useEffect } from 'react';
import type { Building } from '../engine/district';
import { type Livability, scoreLivability } from '../engine/livability';
import { greenDistance, nearestRoad, slopePercent } from '../engine/site';
import type { SunlightEngine } from '../engine/sunlight';
import { viewFrom } from '../engine/view';
import { accessFrom, buildingDoors, minutesOf } from '../engine/walk';
import { getEngine, getRegion, type SceneData } from './data';
import { selectedBuilding, useApp } from './store';

export interface LivabilityResult extends Livability {
  building: number;
}

const cache = new Map<number, LivabilityResult>();

function centroid(ring: Float64Array): [number, number] {
  let x = 0;
  let y = 0;
  const n = ring.length / 2;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i] as number;
    y += ring[i + 1] as number;
  }
  return [x / n, y / n];
}

function builtYearOf(data: SceneData, b: Building): number | null {
  const d = data.district;
  const c = b.compound >= 0 ? d.compounds[b.compound] : undefined;
  if (!c) return null;
  return c.builtYear ?? (c.parent >= 0 ? (d.compounds[c.parent]?.builtYear ?? null) : null);
}

/** 抽几扇窗外看出去，取平均开阔度；窗位按楼层与开间均匀分布 */
function averageOpenness(data: SceneData, engine: SunlightEngine, b: number) {
  const start = data.windowRange[2 * b] as number;
  const n = data.windowRange[2 * b + 1] as number;
  if (n === 0) return 0;
  const samples = Math.min(8, n);
  let sum = 0;
  for (let k = 0; k < samples; k++) {
    const i = start + Math.floor(((k + 0.5) * n) / samples);
    sum += viewFrom(engine, data.grid, i).openness;
  }
  return sum / samples;
}

/** 不渲染任何东西：选中的楼一变就重算（同一栋楼缓存） */
export function LivabilityController({ data }: { data: SceneData }): null {
  const building = useApp((s) => selectedBuilding(s.selection, data.grid));
  const setLivability = useApp((s) => s.setLivability);

  useEffect(() => {
    if (building === null) {
      setLivability(null);
      return;
    }
    const hit = cache.get(building);
    if (hit) {
      setLivability(hit);
      return;
    }
    const b = data.district.buildings[building];
    if (!b) return;
    let alive = true;
    setLivability(null);

    const ring = b.rings[0] as Float64Array;
    const [x, y] = centroid(ring);
    const start = data.windowRange[2 * building] as number;
    const count = data.windowRange[2 * building + 1] as number;
    const windows = data.dahanMinutes.subarray(start, start + count);

    Promise.all([
      getRegion(),
      getEngine().then((engine) => averageOpenness(data, engine, building)),
    ]).then(([{ graph, pois }, openness]) => {
      const access = accessFrom(graph, pois, buildingDoors(graph, ring), 3000);
      const cat = (key: string) => access.categories.find((c) => c.category === key);
      const minutes = (key: string) => {
        const meters = cat(key)?.meters;
        return meters === undefined || !Number.isFinite(meters)
          ? Number.POSITIVE_INFINITY
          : minutesOf(meters);
      };
      const road = nearestRoad(data.district.roads, x, y);
      const result = scoreLivability({
        windows,
        metroMinutes: minutes('metro'),
        busMinutes: minutes('bus'),
        groceryMinutes: minutes('grocery'),
        marketMinutes: minutes('market'),
        medicalMinutes: minutes('medical'),
        parkMinutes: minutes('park'),
        within10: {
          grocery: cat('grocery')?.within10 ?? 0,
          market: cat('market')?.within10 ?? 0,
          food: cat('food')?.within10 ?? 0,
          medical: cat('medical')?.within10 ?? 0,
          park: cat('park')?.within10 ?? 0,
        },
        openness,
        greenMeters: greenDistance(data.district, x, y),
        slopePercent: slopePercent(data.district, x, y),
        roadMeters: road?.meters ?? null,
        roadClass: road?.cls ?? 9,
        builtYear: builtYearOf(data, b),
      });
      const value: LivabilityResult = { ...result, building };
      cache.set(building, value);
      if (cache.size > 16) cache.delete(cache.keys().next().value as number);
      if (alive) setLivability(value);
    });

    return () => {
      alive = false;
    };
  }, [data, building, setLivability]);

  return null;
}
