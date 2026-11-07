/**
 * 区域数据：解码 pipeline/build_region.py 生成的 region.json（v1）。
 *
 * 片区之外的东西都在这里：地铁线路与车站、片区周边与车站周边的步行网、远景底图。
 * 坐标系与 district.json 相同（片区中心为原点，米）。
 */

import type { WalkNetwork } from './district';

/** 出行参数（分钟、米/分钟），与数据管线里的一致 */
export interface TripParams {
  budget: number;
  walkSpeed: number;
  /** 出入口到站台、候车 */
  board: number;
  /** 站内换乘 */
  transfer: number;
  /** 站台到出入口 */
  exit: number;
}

export interface Station {
  name: string;
  x: number;
  y: number;
  /** 出入口坐标 [x0, y0, x1, y1, …]，至少一个 */
  entrances: Float64Array;
}

/** 相邻两站之间的一段轨道，几何从 a 站指向 b 站（a < b） */
export interface TrackSegment {
  a: number;
  b: number;
  points: Float64Array;
  length: number;
}

export interface MetroLine {
  ref: string;
  name: string;
  colour: string;
  /** 平均旅行速度（含停站），米/分钟 */
  speed: number;
  segments: TrackSegment[];
}

export interface Region {
  params: TripParams;
  stations: Station[];
  lines: MetroLine[];
  walk: WalkNetwork;
  basemap: {
    roads: { cls: number; points: Float64Array }[];
    water: { line: Float64Array; width: number }[];
  };
}

interface RegionJson {
  version: 1;
  unit: 'dm';
  params: TripParams;
  stations: { n: string; p: [number, number]; e: number[] }[];
  lines: {
    ref: string;
    name: string;
    colour: string;
    speed: number;
    s: { a: number; b: number; p: number[] }[];
  }[];
  walk: { n: number[]; e: number[]; s: number[] };
  basemap: { roads: { c: number; p: number[] }[]; water: { l: number[]; w: number }[] };
}

const DM = 0.1;
const decode = (a: number[]) => Float64Array.from(a, (v) => v * DM);

export function polylineLength(p: Float64Array): number {
  let len = 0;
  for (let i = 2; i < p.length; i += 2) {
    len += Math.hypot(
      (p[i] as number) - (p[i - 2] as number),
      (p[i + 1] as number) - (p[i - 1] as number),
    );
  }
  return len;
}

export function decodeRegion(json: RegionJson): Region {
  if (json.version !== 1 || json.unit !== 'dm') throw new Error('region.json 版本不受支持');
  return {
    params: json.params,
    stations: json.stations.map((s) => ({
      name: s.n,
      x: s.p[0] * DM,
      y: s.p[1] * DM,
      entrances: decode(s.e),
    })),
    lines: json.lines.map((l) => ({
      ref: l.ref,
      name: l.name,
      colour: l.colour,
      speed: l.speed,
      segments: l.s.map((s) => {
        const points = decode(s.p);
        return { a: s.a, b: s.b, points, length: polylineLength(points) };
      }),
    })),
    walk: {
      nodes: decode(json.walk.n),
      edges: Uint32Array.from(json.walk.e),
      steps: new Set(json.walk.s),
    },
    basemap: {
      roads: json.basemap.roads.map((r) => ({ cls: r.c, points: decode(r.p) })),
      water: json.basemap.water.map((w) => ({ line: decode(w.l), width: w.w })),
    },
  };
}

export async function loadRegion(url: string): Promise<Region> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ${url} 失败：${res.status}`);
  return decodeRegion((await res.json()) as RegionJson);
}

/** 每个车站有哪几条线经过（线路下标） */
export function stationLines(region: Region): number[][] {
  const out = region.stations.map(() => new Set<number>());
  region.lines.forEach((line, li) => {
    for (const s of line.segments) {
      out[s.a]?.add(li);
      out[s.b]?.add(li);
    }
  });
  return out.map((s) => [...s]);
}
