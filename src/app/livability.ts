/**
 * 选中楼的宜居评分：在主线程上收集事实并算分（livabilityFacts.ts），结果写进 store.livability。
 */

import { useEffect } from 'react';
import type { Livability } from '../engine/livability';
import { getEngine, getRegion, type SceneData } from './data';
import { livabilityOf } from './livabilityFacts';
import { selectedBuilding, useApp } from './store';

export interface LivabilityResult extends Livability {
  building: number;
}

const cache = new Map<number, LivabilityResult>();

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
    let alive = true;
    setLivability(null);

    Promise.all([getRegion(), getEngine()]).then(([{ graph, pois, metro, entrances }, engine]) => {
      const result = livabilityOf({ ...data, engine, graph, pois, metro, entrances }, building);
      if (!result) return;
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
