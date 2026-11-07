/**
 * 步行接驳的屏障：河道、水面，以及快速路、主干道、次干道（不在桥上的路段）。
 *
 * 楼的出入口、设施、地铁口要接到步行网上，原来直接接最近的节点，
 * 最近的节点可能在河对岸或大马路对面，画出来的路线就从河上、从马路中间穿过去。
 * 有了屏障，接驳的那一小段不许穿过它们，只能接到同一侧的节点上；
 * 过河、过大马路只能走步行网里的桥和路口。
 */

import type { District } from './district';

/** 屏障线段 [x0, y0, x1, y1, …]：大路中线、河道中线、水面岸线 */
export function barrierSegments(d: District): Float64Array {
  const out: number[] = [];
  const add = (pts: Float64Array, closed: boolean) => {
    const n = pts.length / 2;
    for (let i = 0; i + 1 < n; i++)
      out.push(
        pts[2 * i] as number,
        pts[2 * i + 1] as number,
        pts[2 * i + 2] as number,
        pts[2 * i + 3] as number,
      );
    if (closed && n > 2)
      out.push(
        pts[2 * n - 2] as number,
        pts[2 * n - 1] as number,
        pts[0] as number,
        pts[1] as number,
      );
  };
  for (const r of d.roads) if (r.cls <= 2 && !r.bridge) add(r.points, false);
  for (const w of d.water) {
    if (w.ring) add(w.ring, true);
    else if (w.line) add(w.line, false);
  }
  return Float64Array.from(out);
}

const CELL = 40;

/** 两线段相交的参数 t（沿 a→b），不相交为 −1 */
function hitT(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return -1;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

export class Barriers {
  private readonly segs: Float64Array;
  private readonly cells = new Map<string, number[]>();

  constructor(segs: Float64Array) {
    this.segs = segs;
    for (let k = 0; k < segs.length / 4; k++) {
      const x0 = Math.min(segs[4 * k] as number, segs[4 * k + 2] as number);
      const x1 = Math.max(segs[4 * k] as number, segs[4 * k + 2] as number);
      const y0 = Math.min(segs[4 * k + 1] as number, segs[4 * k + 3] as number);
      const y1 = Math.max(segs[4 * k + 1] as number, segs[4 * k + 3] as number);
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
        for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
          const key = `${i},${j}`;
          const list = this.cells.get(key);
          if (list) list.push(k);
          else this.cells.set(key, [k]);
        }
      }
    }
  }

  /**
   * 从 (ax, ay) 到 (bx, by) 的直线是否穿过屏障。终点 tol 米以内的交点不算：
   * 终点本身就是大路上的节点时，走到路边就停在路上，并没有过到对面。
   */
  crosses(ax: number, ay: number, bx: number, by: number, tol = 1.5): boolean {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) return false;
    const tMax = 1 - tol / len;
    if (tMax <= 0) return false;
    const seen = new Set<number>();
    const i0 = Math.floor(Math.min(ax, bx) / CELL);
    const i1 = Math.floor(Math.max(ax, bx) / CELL);
    const j0 = Math.floor(Math.min(ay, by) / CELL);
    const j1 = Math.floor(Math.max(ay, by) / CELL);
    const s = this.segs;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (const k of this.cells.get(`${i},${j}`) ?? []) {
          if (seen.has(k)) continue;
          seen.add(k);
          const t = hitT(
            ax,
            ay,
            bx,
            by,
            s[4 * k] as number,
            s[4 * k + 1] as number,
            s[4 * k + 2] as number,
            s[4 * k + 3] as number,
          );
          if (t >= 0 && t < tMax) return true;
        }
      }
    }
    return false;
  }
}
