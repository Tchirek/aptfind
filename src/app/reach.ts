/**
 * 选中楼的可达范围：交给 Worker 计算，结果写进 store.reach。
 */

import * as Comlink from 'comlink';
import { useEffect } from 'react';
import { type SceneData, stationOfPoi } from './data';
import type { ReachApi, ReachPayload } from './reach.worker';
import { selectedBuilding, useApp } from './store';

export interface Reach extends ReachPayload {
  building: number;
}

let api: Comlink.Remote<ReachApi> | null = null;
let ready: Promise<void> | null = null;

function worker(data: SceneData): { api: Comlink.Remote<ReachApi>; ready: Promise<void> } {
  if (!api || !ready) {
    const w = new Worker(new URL('./reach.worker.ts', import.meta.url), { type: 'module' });
    api = Comlink.wrap<ReachApi>(w);
    const extra = data.district.pois.flatMap((p) => {
      if (p.category !== 'metro') return [];
      const station = stationOfPoi(p.name);
      return station ? [{ station, x: p.x, y: p.y }] : [];
    });
    ready = api.init(`${import.meta.env.BASE_URL}data/region.json`, extra);
  }
  return { api, ready };
}

const cache = new Map<number, Reach>();

/** 不渲染任何东西：选中的楼一变就重算（同一栋楼缓存） */
export function ReachController({ data }: { data: SceneData }): null {
  const building = useApp((s) => selectedBuilding(s.selection, data.grid));
  const setReach = useApp((s) => s.setReach);

  // 场景出来后就在后台加载区域数据，第一次点楼时不用等
  useEffect(() => {
    worker(data);
  }, [data]);

  useEffect(() => {
    if (building === null) {
      setReach(null);
      return;
    }
    const hit = cache.get(building);
    if (hit) {
      setReach(hit);
      return;
    }
    setReach(null);
    const b = data.district.buildings[building];
    if (!b) return;
    let alive = true;
    const ring = b.rings[0] as Float64Array;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length; i += 2) {
      cx += ring[i] as number;
      cy += ring[i + 1] as number;
    }
    cx /= ring.length / 2;
    cy /= ring.length / 2;
    const w = worker(data);
    w.ready
      .then(() => w.api.compute(Float64Array.from(ring), cx, cy))
      .then((payload) => {
        const reach: Reach = { ...payload, building };
        cache.set(building, reach);
        if (cache.size > 12) cache.delete(cache.keys().next().value as number);
        if (alive) setReach(reach);
      })
      .catch((e: unknown) => console.error('可达范围计算失败', e));
    return () => {
      alive = false;
    };
  }, [data, building, setReach]);

  return null;
}
