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
