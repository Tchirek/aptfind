/**
 * 可达范围（等时圈）：从一栋楼出发，
 * - 只步行：沿路网走，按步速计时；
 * - 步行 + 地铁：走到某站出入口，进站候车、乘车（可换乘）、出站，再从那一站的出入口走出去。
 * 两者都在同一张区域步行网上算出每个节点的到达时刻，再铺成一张连续的"到达时刻场"，
 * 前端用它画 15 分钟、30 分钟两条等时线。
 */

import type { MetroGraph, RideLeg } from './metro';
import type { Region } from './region';
import type { Door, Seed, WalkGraph } from './walk';

/** 出入口吸附到步行网 */
export interface Entrance {
  station: number;
  node: number;
  snap: number;
}

export function snapEntrances(graph: WalkGraph, region: Region, maxSnap = 250): Entrance[] {
  const out: Entrance[] = [];
  region.stations.forEach((s, station) => {
    for (let i = 0; i < s.entrances.length; i += 2) {
      const { node, distance } = graph.nearest(
        s.entrances[i] as number,
        s.entrances[i + 1] as number,
      );
      if (node >= 0 && distance <= maxSnap) out.push({ station, node, snap: distance });
    }
  });
  return out;
}

export interface ReachedStation {
  station: number;
  /** 上车的那一站在哪个时刻进站（含走到出入口） */
  arrival: number;
  /** 出站到地面的时刻 */
  exit: number;
  /** 依次乘坐的线路（MetroGraph 里的线路下标） */
  lines: number[];
}

export interface Isochrone {
  budget: number;
  /** 每个路网节点的到达时刻（分钟），到不了为 Infinity */
  walk: Float32Array;
  combined: Float32Array;
  /** 坐地铁能在预算内出站的车站（不含只是路过的） */
  stations: ReachedStation[];
  legs: RideLeg[];
}

export function computeIsochrone(
  graph: WalkGraph,
  metro: MetroGraph,
  entrances: readonly Entrance[],
  doors: readonly Door[],
  budget = metro.params.budget,
): Isochrone {
  const p = metro.params;
  const speed = p.walkSpeed;
  const maxMeters = budget * speed;

  const walkPaths = graph.shortestFrom(doors, maxMeters);
  const walk = Float32Array.from(walkPaths.dist, (m) => m / speed);

  // 各站最早能上车的时刻：走到任一出入口 + 进站候车
  const boards = new Float64Array(metro.stationCount).fill(Number.POSITIVE_INFINITY);
  for (const e of entrances) {
    const t = (walk[e.node] as number) + e.snap / speed + p.board;
    if (t < (boards[e.station] as number)) boards[e.station] = t;
  }
  const ride = metro.ride(boards, budget - p.exit);

  // 出站后从各出入口继续步行：把出站时刻折成"已走过的米数"，与楼的出入口一起做多源最短路
  const seeds: Seed[] = doors.map((d) => ({ node: d.node, dist: d.dist }));
  const stations: ReachedStation[] = [];
  ride.arrival.forEach((t, station) => {
    const exit = t + p.exit;
    if (!Number.isFinite(t) || exit >= budget) return;
    // 直接走过去更快的站（包括上车站本身）不算"坐地铁到的"
    const walkThere = (boards[station] as number) - p.board;
    if (walkThere <= exit) return;
    stations.push({ station, arrival: t, exit, lines: ride.lines[station] ?? [] });
  });
  for (const e of entrances) {
    const t = (ride.arrival[e.station] as number) + p.exit;
    if (!Number.isFinite(t) || t >= budget) continue;
    seeds.push({ node: e.node, dist: (t + e.snap / speed) * speed });
  }
  const combinedPaths = graph.shortestFrom(seeds, maxMeters);
  const combined = Float32Array.from(combinedPaths.dist, (m) => m / speed);

  stations.sort((a, b) => a.exit - b.exit);
  // 只留通往"能出站的车站"的乘车区间
  const useful = new Set(stations.map((s) => s.station));
  const needed = new Set<number>();
  const byTo = new Map<number, RideLeg>();
  for (const leg of ride.legs) byTo.set(leg.to, leg);
  for (const s of useful) {
    for (let leg = byTo.get(s); leg && !needed.has(leg.to); leg = byTo.get(leg.from)) {
      needed.add(leg.to);
    }
  }
  const legs = ride.legs.filter((l) => needed.has(l.to));
  return { budget, walk, combined, stations, legs };
}

/** 规则网格：第 (i, j) 格的中心在 (x0 + (i + 0.5)·cell, y0 + (j + 0.5)·cell) */
export interface FieldGrid {
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
}

/** 覆盖所有预算内节点的网格；可限定在 (cx, cy) 周围 radius 米内 */
export function fieldGrid(
  graph: WalkGraph,
  times: Float32Array,
  budget: number,
  opts: { margin: number; maxCells: number; minCell: number; around?: [number, number, number] },
): FieldGrid | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < graph.nodeCount; i++) {
    if (!((times[i] as number) <= budget)) continue;
    const x = graph.x(i);
    const y = graph.y(i);
    if (opts.around) {
      const [cx, cy, r] = opts.around;
      if (Math.abs(x - cx) > r || Math.abs(y - cy) > r) continue;
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  minX -= opts.margin;
  minY -= opts.margin;
  maxX += opts.margin;
  maxY += opts.margin;
  const cell = Math.max(opts.minCell, Math.max(maxX - minX, maxY - minY) / opts.maxCells);
  return {
    x0: minX,
    y0: minY,
    cell,
    nx: Math.ceil((maxX - minX) / cell),
    ny: Math.ceil((maxY - minY) / cell),
  };
}

/** 场里"到不了"的取值 */
export const FAR = 999;

/**
 * 把节点到达时刻铺成连续场，两个通道交错存放：[只步行, 步行 + 地铁]。
 *
 * 先沿每条路的中心线写入路上各点的时刻（从两端较早的一端走过来），
 * 再用两遍倒角距离变换向路外扩散：离路每多 1 米加 offroad / speed 分钟，
 * 相当于穿过院落、楼间空地走到路上，比沿路走慢一些。这样街区内部不会出现空洞，
 * 等时线在路网末端自然收拢成圆头。
 */
export function rasterizeField(
  graph: WalkGraph,
  iso: Isochrone,
  grid: FieldGrid,
  speed: number,
  offroad = 1.4,
): Float32Array {
  const { x0, y0, cell, nx, ny } = grid;
  const field = new Float32Array(nx * ny * 2).fill(FAR);
  const limit = iso.budget + 10;
  const chans = [iso.walk, iso.combined] as const;
  const m = graph.edgeCost.length;
  const step = cell * 0.5;

  for (let e = 0; e < m; e++) {
    const a = graph.edgeNodes[2 * e] as number;
    const b = graph.edgeNodes[2 * e + 1] as number;
    const ca = iso.combined[a] as number;
    const cb = iso.combined[b] as number;
    if (!(Math.min(ca, cb) <= limit)) continue;
    const ax = graph.x(a);
    const ay = graph.y(a);
    const bx = graph.x(b);
    const by = graph.y(b);
    const len = Math.hypot(bx - ax, by - ay);
    const span = (graph.edgeCost[e] as number) / speed;
    const k = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s <= k; s++) {
      const u = s / k;
      const i = Math.floor((ax + (bx - ax) * u - x0) / cell);
      const j = Math.floor((ay + (by - ay) * u - y0) / cell);
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const o = (j * nx + i) * 2;
      for (let c = 0; c < 2; c++) {
        const t = Math.min(
          ((chans[c] as Float32Array)[a] as number) + u * span,
          ((chans[c] as Float32Array)[b] as number) + (1 - u) * span,
        );
        if (t < (field[o + c] as number)) field[o + c] = t;
      }
    }
  }

  // 两遍 3×3 倒角距离变换
  const d1 = (cell * offroad) / speed;
  const d2 = d1 * Math.SQRT2;
  const relax = (o: number, q: number, w: number) => {
    for (let c = 0; c < 2; c++) {
      const v = (field[q + c] as number) + w;
      if (v < (field[o + c] as number)) field[o + c] = v;
    }
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 2;
      if (i > 0) relax(o, o - 2, d1);
      if (j > 0) {
        relax(o, o - nx * 2, d1);
        if (i > 0) relax(o, o - nx * 2 - 2, d2);
        if (i < nx - 1) relax(o, o - nx * 2 + 2, d2);
      }
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const o = (j * nx + i) * 2;
      if (i < nx - 1) relax(o, o + 2, d1);
      if (j < ny - 1) {
        relax(o, o + nx * 2, d1);
        if (i < nx - 1) relax(o, o + nx * 2 + 2, d2);
        if (i > 0) relax(o, o + nx * 2 - 2, d2);
      }
    }
  }
  return field;
}

/** 预算内可达的面积（平方米），按场的格子数估算 */
export function reachableArea(
  field: Float32Array,
  grid: FieldGrid,
  channel: 0 | 1,
  minutes: number,
) {
  let n = 0;
  for (let k = channel; k < field.length; k += 2) if ((field[k] as number) <= minutes) n++;
  return n * grid.cell * grid.cell;
}
