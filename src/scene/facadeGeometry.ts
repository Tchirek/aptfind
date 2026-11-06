/**
 * 外墙窗格：每个窗位画成墙面上内缩的一格，颜色按日照分钟数分档。
 * 二十多万格合并成一个几何体，一次绘制。
 */

import { BufferAttribute, BufferGeometry } from 'three';
import type { WindowGrid } from '../engine/geometry';
import { BIN_RGB, binOf } from '../ui/palette';

/** 窗格离墙面的距离（米），配合 polygonOffset 避免与墙面深度冲突 */
const LIFT = 0.06;

export function buildFacadeGeometry(grid: WindowGrid): BufferGeometry {
  const n = grid.count;
  const pos = new Float32Array(n * 12);
  const index = new Uint32Array(n * 6);

  for (let i = 0; i < n; i++) {
    const x0 = grid.x0[i] as number;
    const y0 = grid.y0[i] as number;
    const dx = (grid.x1[i] as number) - x0;
    const dy = (grid.y1[i] as number) - y0;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    // 外法线
    const nx = uy * LIFT;
    const ny = -ux * LIFT;
    const margin = Math.min(0.45, len * 0.14);
    const z0 = grid.z0[i] as number;
    const z1 = grid.z1[i] as number;
    const fh = z1 - z0;
    const bottom = z0 + fh * 0.2;
    const top = z1 - fh * 0.12;

    const ax = x0 + ux * margin + nx;
    const ay = y0 + uy * margin + ny;
    const bx = x0 + ux * (len - margin) + nx;
    const by = y0 + uy * (len - margin) + ny;
    pos.set([ax, ay, bottom, bx, by, bottom, bx, by, top, ax, ay, top], i * 12);
    const v = i * 4;
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(new Uint8Array(n * 12), 3, true));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/** 按日照分钟数给窗格上色 */
export function paintFacades(g: BufferGeometry, minutes: Float32Array): void {
  const attr = g.getAttribute('color') as BufferAttribute;
  const col = attr.array as Uint8Array;
  for (let i = 0; i < minutes.length; i++) {
    const b = binOf(minutes[i] as number) * 3;
    const r = BIN_RGB[b] as number;
    const gg = BIN_RGB[b + 1] as number;
    const bb = BIN_RGB[b + 2] as number;
    for (let k = 0; k < 4; k++) {
      const o = i * 12 + k * 3;
      col[o] = r;
      col[o + 1] = gg;
      col[o + 2] = bb;
    }
  }
  attr.needsUpdate = true;
}

/**
 * 命中三角形的顶点下标 → 窗位下标。每个窗格独占 4 个顶点；BVH 会重排三角形索引，
 * 但不动顶点，所以按顶点反查才可靠。
 */
export const vertexToWindow = (vertex: number) => Math.floor(vertex / 4);
