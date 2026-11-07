/**
 * 选中那栋楼在所选日期的逐窗日照（日出到日落）：在主线程分帧计算，每帧最多占 8 ms，
 * 从底层往上一层层算，界面上看到的是外墙由下而上逐层着色。
 * 同一栋楼、同一天的结果缓存起来，来回切换不重算。
 */

import { useEffect } from 'react';
import { SunPath } from '../engine/sunlight';
import { getEngine, type SceneData } from './data';
import { selectedBuilding, useApp } from './store';
import { dateToIso, daylightSpec } from './time';

export interface BuildingSunlight {
  building: number;
  /** 窗位区间起点与长度（全局下标） */
  start: number;
  /** 各窗位日照分钟数，没算出来的为 NaN */
  minutes: Float32Array;
  done: number;
}

const cache = new Map<string, Float32Array>();
const MAX_CACHE = 24;
const FRAME_BUDGET_MS = 8;

/** 不渲染任何东西：跟着选中的楼与日期计算，结果写进 store.sunlight */
export function SunlightController({ data }: { data: SceneData }): null {
  const building = useApp((s) => selectedBuilding(s.selection, data.grid));
  const iso = useApp((s) => dateToIso(s.date));
  const setState = useApp((s) => s.setSunlight);

  useEffect(() => {
    if (building === null) {
      setState(null);
      return;
    }
    const start = data.windowRange[2 * building] as number;
    const n = data.windowRange[2 * building + 1] as number;
    if (n === 0) {
      setState(null);
      return;
    }
    const key = `${building}@${iso}`;
    const hit = cache.get(key);
    if (hit) {
      setState({ building, start, minutes: hit, done: n });
      return;
    }

    const minutes = new Float32Array(n).fill(Number.NaN);
    setState({ building, start, minutes, done: 0 });
    // 按层排序：由下而上
    const order = Array.from({ length: n }, (_, k) => k).sort(
      (a, b) => (data.grid.floor[start + a] as number) - (data.grid.floor[start + b] as number),
    );
    let alive = true;
    let raf = 0;
    let next = 0;
    getEngine().then((engine) => {
      if (!alive) return;
      const path = new SunPath(isoDate(iso));
      const tick = () => {
        if (!alive) return;
        const t0 = performance.now();
        while (next < n && performance.now() - t0 < FRAME_BUDGET_MS) {
          const l = order[next] as number;
          minutes[l] = engine.trace(data.grid, start + l, path);
          next++;
        }
        setState({ building, start, minutes, done: next });
        if (next < n) {
          raf = requestAnimationFrame(tick);
        } else {
          cache.set(key, minutes);
          if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
        }
      };
      raf = requestAnimationFrame(tick);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [data, building, iso, setState]);

  return null;
}

function isoDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return daylightSpec({ year: y, month: m, day: d });
}
