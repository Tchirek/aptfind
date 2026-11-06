/**
 * 地面要素：道路画成带宽度的条带，水系画成面或宽线。全部是 z = 0 平面上的 ENU 几何。
 */

import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three';
import type { Road, Water } from '../engine/district';

/** 各级道路的路面宽度（米） */
const ROAD_WIDTH = [26, 20, 14, 9, 6, 3.5] as const;

/** 折线 → 条带三角形，段与段之间补一个扇形接头，避免折角处开口 */
function ribbon(points: Float64Array, width: number, z: number, out: number[]): void {
  const h = width / 2;
  const n = points.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const ax = points[2 * i] as number;
    const ay = points[2 * i + 1] as number;
    const bx = points[2 * i + 2] as number;
    const by = points[2 * i + 3] as number;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const ox = (-(by - ay) / len) * h;
    const oy = ((bx - ax) / len) * h;
    out.push(ax - ox, ay - oy, z, bx - ox, by - oy, z, bx + ox, by + oy, z);
    out.push(ax - ox, ay - oy, z, bx + ox, by + oy, z, ax + ox, ay + oy, z);
    // 接头：在 b 点补一个小八边形
    if (i < n - 2) {
      for (let k = 0; k < 8; k++) {
        const t0 = (k / 8) * Math.PI * 2;
        const t1 = ((k + 1) / 8) * Math.PI * 2;
        out.push(
          bx,
          by,
          z,
          bx + Math.cos(t0) * h,
          by + Math.sin(t0) * h,
          z,
          bx + Math.cos(t1) * h,
          by + Math.sin(t1) * h,
          z,
        );
      }
    }
  }
}

function toGeometry(pos: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

export function buildRoadGeometry(roads: readonly Road[], minorOnly: boolean): BufferGeometry {
  const pos: number[] = [];
  for (const r of roads) {
    const minor = r.cls >= 4;
    if (minor !== minorOnly) continue;
    ribbon(r.points, ROAD_WIDTH[r.cls] ?? 4, minor ? 0.02 : 0.04, pos);
  }
  return toGeometry(pos);
}

export function buildWaterGeometry(water: readonly Water[]): BufferGeometry {
  const pos: number[] = [];
  for (const w of water) {
    if (w.ring) {
      const pts: Vector2[] = [];
      for (let i = 0; i < w.ring.length; i += 2) pts.push(new Vector2(w.ring[i], w.ring[i + 1]));
      for (const [a, b, c] of ShapeUtils.triangulateShape(pts, [])) {
        for (const k of [a, b, c]) {
          const p = pts[k as number] as Vector2;
          pos.push(p.x, p.y, 0.01);
        }
      }
    } else if (w.line) {
      ribbon(w.line, w.width, 0.01, pos);
    }
  }
  return toGeometry(pos);
}
