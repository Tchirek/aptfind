/**
 * 地铁出入口：OSM 的车站出入口，加上片区里高德的出入口（比 OSM 全）。
 * 页面与离线预计算共用，不引用 import.meta。
 */

import type { Poi } from '../engine/district';
import { type Entrance, snapEntrances } from '../engine/isochrone';
import type { Region } from '../engine/region';
import type { WalkGraph } from '../engine/walk';

/** '四川师大地铁站F口'、'四川师大(地铁站)' → '四川师大' */
export function stationOfPoi(name: string): string | null {
  const m = name.match(/^(.+?)(?:地铁站|\(地铁站\)|（地铁站）)/);
  return m ? (m[1] as string) : null;
}

/** 片区里的地铁出入口以高德为准（比 OSM 全），并到对应车站上 */
export function districtEntrances(
  graph: WalkGraph,
  region: Region,
  pois: readonly Poi[],
): Entrance[] {
  const index = new Map(region.stations.map((s, i) => [s.name, i]));
  const out: Entrance[] = [];
  for (const p of pois) {
    if (p.category !== 'metro') continue;
    const name = stationOfPoi(p.name);
    const station = name === null ? undefined : index.get(name);
    if (station === undefined) continue;
    const { node, distance } = graph.nearest(p.x, p.y);
    if (node >= 0 && distance <= 250) out.push({ station, node, snap: distance });
  }
  return out;
}

export function allEntrances(graph: WalkGraph, region: Region, pois: readonly Poi[]): Entrance[] {
  return [...snapEntrances(graph, region), ...districtEntrances(graph, region, pois)];
}
