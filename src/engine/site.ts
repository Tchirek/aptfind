/**
 * 场地条件：从场景数据里取几项与选址有关、又与日照无关的几何量。
 * 距离一律是平面直线距离（米），坡度取自地形栅格。
 */

import { type District, type Road, terrainAt } from './district';

/** 点到线段所在折线的最近距离 */
export function distanceToPolyline(px: number, py: number, pts: Float64Array): number {
  const n = pts.length / 2;
  if (n === 0) return Number.POSITIVE_INFINITY;
  if (n === 1) return Math.hypot(px - (pts[0] as number), py - (pts[1] as number));
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[2 * i] as number;
    const ay = pts[2 * i + 1] as number;
    const bx = pts[2 * i + 2] as number;
    const by = pts[2 * i + 3] as number;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / len2, 0), 1);
    const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    if (d < best) best = d;
  }
  return best;
}

export interface NearbyRoad {
  meters: number;
  cls: number;
}

/**
 * 最近的主干道：只考虑快速路、主干道、次干道（cls ≤ 2），
 * 太远的支路对噪声没什么影响，直接不取。
 */
export function nearestRoad(
  roads: readonly Road[],
  x: number,
  y: number,
  maxClass = 2,
  maxMeters = 600,
): NearbyRoad | null {
  let best: NearbyRoad | null = null;
  for (const r of roads) {
    if (r.cls > maxClass) continue;
    const d = distanceToPolyline(x, y, r.points);
    if (d <= maxMeters && (!best || d < best.meters)) best = { meters: d, cls: r.cls };
  }
  return best;
}

/** 楼基处的地面坡度，百分比（高差 / 水平距离 × 100） */
export function slopePercent(d: District, x: number, y: number, step = 12): number {
  const zx = (terrainAt(d.terrain, x + step, y) - terrainAt(d.terrain, x - step, y)) / (2 * step);
  const zy = (terrainAt(d.terrain, x, y + step) - terrainAt(d.terrain, x, y - step)) / (2 * step);
  return Math.hypot(zx, zy) * 100;
}

/** 公园 POI 视作有约 100 m 半径的绿地，站在边上就算 0 */
const PARK_RADIUS = 100;

/** 到最近水面或公园绿地的距离（米）；水面按岸线算，河道扣掉半宽 */
export function greenDistance(d: District, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const w of d.water) {
    if (w.ring) {
      const ring = w.ring;
      // 面状水体：岸线是闭合的，最后一段要补上
      const closed = new Float64Array(ring.length + 2);
      closed.set(ring);
      closed[ring.length] = ring[0] as number;
      closed[ring.length + 1] = ring[1] as number;
      best = Math.min(best, distanceToPolyline(x, y, closed));
    } else if (w.line) {
      best = Math.min(best, Math.max(0, distanceToPolyline(x, y, w.line) - w.width / 2));
    }
  }
  for (const p of d.pois) {
    if (p.category !== 'park') continue;
    best = Math.min(best, Math.max(0, Math.hypot(p.x - x, p.y - y) - PARK_RADIUS));
  }
  return Number.isFinite(best) ? best : Number.POSITIVE_INFINITY;
}

/** 到快速路、主干道、次干道（cls 0、1、2）各自最近的直线距离（米），maxMeters 外记 Infinity */
export function roadDistances(
  roads: readonly Road[],
  x: number,
  y: number,
  maxMeters = 600,
): [number, number, number] {
  const out: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  for (const r of roads) {
    if (r.cls > 2) continue;
    const d = distanceToPolyline(x, y, r.points);
    if (d <= maxMeters && d < (out[r.cls] as number)) out[r.cls] = d;
  }
  return out;
}

/** 到最近一段铁路干线的距离（米）；maxMeters 以外记为无穷远 */
export function railDistance(
  rails: readonly Float64Array[],
  x: number,
  y: number,
  maxMeters = 600,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const r of rails) best = Math.min(best, distanceToPolyline(x, y, r));
  return best <= maxMeters ? best : Number.POSITIVE_INFINITY;
}

function ringArea(ring: Float64Array): number {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (ring[2 * i] as number) * (ring[2 * j + 1] as number);
    a -= (ring[2 * j] as number) * (ring[2 * i + 1] as number);
  }
  return Math.abs(a) / 2;
}

const footprints = new WeakMap<District, Float64Array>();

/** 每栋楼的 [质心 x, 质心 y, 基底面积]，按 district 缓存 */
function footprintTable(d: District): Float64Array {
  let t = footprints.get(d);
  if (!t) {
    t = new Float64Array(d.buildings.length * 3);
    d.buildings.forEach((b, i) => {
      const [outer, ...holes] = b.rings;
      if (!outer) return;
      let cx = 0;
      let cy = 0;
      for (let k = 0; k < outer.length; k += 2) {
        cx += outer[k] as number;
        cy += outer[k + 1] as number;
      }
      const n = outer.length / 2;
      (t as Float64Array).set(
        [cx / n, cy / n, ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0)],
        3 * i,
      );
    });
    footprints.set(d, t);
  }
  return t;
}

/**
 * 以 (x, y) 为圆心、radius 为半径的圆里的建筑覆盖率：质心落在圆内的楼的基底面积之和 ÷ 圆面积。
 * 老旧多层挤在一起时高，塔楼小区楼间留出大片空地时低。
 */
export function builtCoverage(d: District, x: number, y: number, radius = 150): number {
  const t = footprintTable(d);
  const r2 = radius * radius;
  let sum = 0;
  for (let i = 0; i < t.length; i += 3) {
    const dx = (t[i] as number) - x;
    const dy = (t[i + 1] as number) - y;
    if (dx * dx + dy * dy <= r2) sum += t[i + 2] as number;
  }
  return Math.min(1, sum / (Math.PI * r2));
}
