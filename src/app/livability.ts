/**
 * 选中楼的宜居评分：在主线程上收集事实（livabilityFacts.ts），按当前视角算分，结果写进 store.livability。
 * 事实按楼缓存，换视角只重新加权，不用重算步行与视野。
 */

import { useEffect } from 'react';
import { type Livability, type LivabilityFacts, scoreLivability } from '../engine/livability';
import { getEngine, getRegion, type SceneData } from './data';
import { livabilityFacts } from './livabilityFacts';
import { selectedBuilding, useApp } from './store';

export interface LivabilityResult extends Livability {
  building: number;
}

const cache = new Map<number, LivabilityFacts>();

/** 不渲染任何东西：选中的楼或视角一变就重算 */
export function LivabilityController({ data }: { data: SceneData }): null {
  const building = useApp((s) => selectedBuilding(s.selection, data.grid));
  const profile = useApp((s) => s.profile);
  const setLivability = useApp((s) => s.setLivability);

  useEffect(() => {
    if (building === null) {
      setLivability(null);
      return;
    }
    const hit = cache.get(building);
    if (hit) {
      setLivability({ ...scoreLivability(hit, profile), building });
      return;
    }
    let alive = true;
    setLivability(null);

    Promise.all([getRegion(), getEngine()]).then(([region, engine]) => {
      const { graph, pois, metro, entrances, stationLines } = region;
      const facts = livabilityFacts(
        { ...data, engine, graph, pois, metro, entrances, stationLines },
        building,
      );
      if (!facts) return;
      cache.set(building, facts);
      if (cache.size > 16) cache.delete(cache.keys().next().value as number);
      if (alive) setLivability({ ...scoreLivability(facts, profile), building });
    });

    return () => {
      alive = false;
    };
  }, [data, building, profile, setLivability]);

  return null;
}
