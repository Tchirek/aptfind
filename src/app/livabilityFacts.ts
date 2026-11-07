/**
 * 一栋楼的宜居评分：收集事实（日照、步行、视野、场地、楼龄），交给纯函数 scoreLivability。
 * 页面上的 LivabilityController 与离线的 scripts/precompute-livability.ts 共用这一份，
 * 屋顶按预计算的分数着色，与点开楼看到的分数必然一致。
 *
 * 这里不引用 app/data.ts（那边一导入就会去加载数据），只用它的类型。
 */

import type { District } from '../engine/district';
import { type WindowGrid, wallAzimuth } from '../engine/geometry';
import { type Livability, scoreLivability } from '../engine/livability';
import { greenDistance, nearestRoad, slopePercent } from '../engine/site';
import type { SunlightEngine } from '../engine/sunlight';
import { viewFrom } from '../engine/view';
import {
  accessFrom,
  buildingDoors,
  minutesOf,
  type SnappedPoi,
  type WalkGraph,
} from '../engine/walk';

export interface LivabilityContext {
  district: District;
  grid: WindowGrid;
  dahanMinutes: Float32Array;
  windowRange: Uint32Array;
  engine: SunlightEngine;
  graph: WalkGraph;
  pois: readonly SnappedPoi[];
}

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

/** 楼所在小区的建成年代；小区没有就看上级地块 */
export function builtYearOf(d: District, compound: number): number | null {
  const c = d.compounds[compound];
  if (!c) return null;
  return c.builtYear ?? (c.parent >= 0 ? (d.compounds[c.parent]?.builtYear ?? null) : null);
}

/** 抽几扇窗外看出去，取平均开阔度；窗位按楼层与开间均匀分布 */
function averageOpenness(ctx: LivabilityContext, b: number): number {
  const start = ctx.windowRange[2 * b] as number;
  const n = ctx.windowRange[2 * b + 1] as number;
  if (n === 0) return 0;
  const samples = Math.min(8, n);
  let sum = 0;
  for (let k = 0; k < samples; k++) {
    const i = start + Math.floor(((k + 0.5) * n) / samples);
    sum += viewFrom(ctx.engine, ctx.grid, i).openness;
  }
  return sum / samples;
}

export function livabilityOf(ctx: LivabilityContext, building: number): Livability | null {
  const b = ctx.district.buildings[building];
  if (!b) return null;
  const ring = b.rings[0] as Float64Array;
  const [x, y] = centroid(ring);
  const start = ctx.windowRange[2 * building] as number;
  const count = ctx.windowRange[2 * building + 1] as number;
  const windows = ctx.dahanMinutes.subarray(start, start + count);
  const windowAzimuths = Float32Array.from({ length: count }, (_, k) =>
    wallAzimuth(ctx.grid, start + k),
  );

  const access = accessFrom(ctx.graph, ctx.pois, buildingDoors(ctx.graph, ring), 3000);
  const cat = (key: string) => access.categories.find((c) => c.category === key);
  const minutes = (key: string) => {
    const meters = cat(key)?.meters;
    return meters === undefined || !Number.isFinite(meters)
      ? Number.POSITIVE_INFINITY
      : minutesOf(meters);
  };
  const road = nearestRoad(ctx.district.roads, x, y);
  return scoreLivability({
    windows,
    windowAzimuths,
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
    openness: averageOpenness(ctx, building),
    greenMeters: greenDistance(ctx.district, x, y),
    slopePercent: slopePercent(ctx.district, x, y),
    roadMeters: road?.meters ?? null,
    roadClass: road?.cls ?? 9,
    builtYear: builtYearOf(ctx.district, b.compound),
  });
}
