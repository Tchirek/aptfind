/**
 * 建筑与地形几何：挤出成实体（供射线求交与渲染），以及在外墙上划分逐窗采样网格。
 */

import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three';
import type { Building, Terrain } from './district';

/** 窗台高度：GB 50180 规定日照计算起点为底层窗台面，逐层同理取各层窗台 */
export const SILL_HEIGHT = 0.9;
/** 一个开间的目标宽度（米），外墙按此划分窗位 */
export const BAY_WIDTH = 3.3;
/** 比这更短的墙段不设窗位（多为轮廓简化留下的折角） */
export const MIN_WALL_LENGTH = 1.5;
/** 采样点离墙面的距离，避免射线打中自己的墙 */
const SAMPLE_OFFSET = 0.05;
/** 住宅层高按 3 m 估算；实地核验的楼高也按"层数 × 3 m"存放，两者一致 */
export const FLOOR_HEIGHT = 3;
/** 地形三角形在 vertexBuilding 里的归属标记 */
export const TERRAIN_OWNER = 0xffffffff;

export const floorsOf = (height: number) => Math.max(1, Math.round(height / FLOOR_HEIGHT));

/** 楼高可被覆盖（用户拔楼、实地核验），这里统一取值 */
export type HeightOf = (b: Building) => number;
export const defaultHeight: HeightOf = (b) => b.height;

export interface Solids {
  geometry: BufferGeometry;
  /** 每个顶点所属建筑的下标（地形为 TERRAIN_OWNER），用来从射线命中点反查是谁挡住的 */
  vertexBuilding: Uint32Array;
}

function ringPoints(ring: Float64Array): Vector2[] {
  const pts: Vector2[] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push(new Vector2(ring[i], ring[i + 1]));
  return pts;
}

/** 地形网格的三角形（ENU，z 向上），每格两个三角形，从上往下看逆时针 */
export function terrainTriangles(t: Terrain, out: number[] = []): number[] {
  const z = (i: number, j: number) => t.z[j * t.nx + i] as number;
  for (let j = 0; j < t.ny - 1; j++) {
    for (let i = 0; i < t.nx - 1; i++) {
      const x0 = t.x0 + i * t.step;
      const y0 = t.y0 + j * t.step;
      const x1 = x0 + t.step;
      const y1 = y0 + t.step;
      out.push(x0, y0, z(i, j), x1, y0, z(i + 1, j), x1, y1, z(i + 1, j + 1));
      out.push(x0, y0, z(i, j), x1, y1, z(i + 1, j + 1), x0, y1, z(i, j + 1));
    }
  }
  return out;
}

/**
 * 把建筑挤出成非索引三角网格（ENU，z 向上）：外墙、内院墙与平屋顶，墙从基底高程起算。
 * 传入 terrain 时把地形也并进来，作为遮挡物参与射线求交。
 */
export function buildSolids(
  buildings: readonly Building[],
  heightOf: HeightOf = defaultHeight,
  terrain?: Terrain,
): Solids {
  const pos: number[] = [];
  const owner: number[] = [];

  for (const b of buildings) {
    const h = heightOf(b);
    if (h <= 0) continue;
    const before = pos.length;
    const z0 = b.base;
    const z1 = b.base + h;

    for (const ring of b.rings) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = ring[2 * i] as number;
        const ay = ring[2 * i + 1] as number;
        const bx = ring[2 * j] as number;
        const by = ring[2 * j + 1] as number;
        // 外墙向外（外轮廓逆时针、内院顺时针时，实体都在边的左侧）
        pos.push(ax, ay, z0, bx, by, z0, bx, by, z1);
        pos.push(ax, ay, z0, bx, by, z1, ax, ay, z1);
      }
    }

    const [outer, ...holes] = b.rings;
    if (outer) {
      const contour = ringPoints(outer);
      const holePts = holes.map(ringPoints);
      const all = [contour, ...holePts].flat();
      for (const tri of ShapeUtils.triangulateShape(contour, holePts)) {
        const [p, q, r] = tri.map((k) => all[k] as Vector2) as [Vector2, Vector2, Vector2];
        // 保证屋顶三角形从上往下看是逆时针，法线朝上
        const ccw = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) > 0;
        const [s, t] = ccw ? [q, r] : [r, q];
        pos.push(p.x, p.y, z1, s.x, s.y, z1, t.x, t.y, z1);
      }
    }

    for (let k = before; k < pos.length; k += 3) owner.push(b.index);
  }

  if (terrain) {
    const before = pos.length;
    terrainTriangles(terrain, pos);
    for (let k = before; k < pos.length; k += 3) owner.push(TERRAIN_OWNER);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.computeVertexNormals();
  return { geometry, vertexBuilding: Uint32Array.from(owner) };
}

/**
 * 外墙上的逐窗网格，按"结构数组"存放以便在 Worker 之间零拷贝传递。
 * 第 i 个窗位是墙段 (x0,y0)→(x1,y1) 上、z0 到 z1 之间的一格。
 * 同一面墙的窗位连续存放：下标 = wallStart[w] + 开间 × wallFloors[w] + 层。
 */
export interface WindowGrid {
  count: number;
  x0: Float32Array;
  y0: Float32Array;
  x1: Float32Array;
  y1: Float32Array;
  z0: Float32Array;
  z1: Float32Array;
  building: Uint32Array;
  floor: Uint16Array;
  wall: Uint32Array;
  wallStart: Uint32Array;
  wallBays: Uint16Array;
  wallFloors: Uint16Array;
}

/** 墙段外法线的方位角（正北 0°，顺时针） */
export function wallAzimuth(g: WindowGrid, i: number): number {
  const dx = (g.x1[i] as number) - (g.x0[i] as number);
  const dy = (g.y1[i] as number) - (g.y0[i] as number);
  // 外法线 = 边方向右转 90°：(dy, -dx)
  const az = (Math.atan2(dy, -dx) * 180) / Math.PI;
  return (az + 360) % 360;
}

export interface WindowSample {
  px: number;
  py: number;
  pz: number;
  /** 水平外法线 */
  nx: number;
  ny: number;
}

/** 窗位的采样点：开间中点、窗台高度，向外偏移一点 */
export function windowSample(g: WindowGrid, i: number, out: WindowSample): WindowSample {
  const x0 = g.x0[i] as number;
  const y0 = g.y0[i] as number;
  const dx = (g.x1[i] as number) - x0;
  const dy = (g.y1[i] as number) - y0;
  const len = Math.hypot(dx, dy);
  out.nx = dy / len;
  out.ny = -dx / len;
  out.px = x0 + dx / 2 + out.nx * SAMPLE_OFFSET;
  out.py = y0 + dy / 2 + out.ny * SAMPLE_OFFSET;
  const z0 = g.z0[i] as number;
  out.pz = z0 + Math.min(SILL_HEIGHT, ((g.z1[i] as number) - z0) / 2);
  return out;
}

export function buildWindowGrid(
  buildings: readonly Building[],
  include: (b: Building) => boolean = (b) => b.core,
  heightOf: HeightOf = defaultHeight,
): WindowGrid {
  const x0: number[] = [];
  const y0: number[] = [];
  const x1: number[] = [];
  const y1: number[] = [];
  const z0: number[] = [];
  const z1: number[] = [];
  const building: number[] = [];
  const floor: number[] = [];
  const wall: number[] = [];
  const wallStart: number[] = [];
  const wallBays: number[] = [];
  const wallFloors: number[] = [];

  for (const b of buildings) {
    if (!include(b)) continue;
    const h = heightOf(b);
    if (h <= 0) continue;
    const floors = floorsOf(h);
    const fh = h / floors;

    for (const ring of b.rings) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = ring[2 * i] as number;
        const ay = ring[2 * i + 1] as number;
        const bx = ring[2 * j] as number;
        const by = ring[2 * j + 1] as number;
        const len = Math.hypot(bx - ax, by - ay);
        if (len < MIN_WALL_LENGTH) continue;
        const bays = Math.max(1, Math.round(len / BAY_WIDTH));
        const w = wallStart.length;
        wallStart.push(building.length);
        wallBays.push(bays);
        wallFloors.push(floors);
        for (let k = 0; k < bays; k++) {
          const t0 = k / bays;
          const t1 = (k + 1) / bays;
          for (let f = 0; f < floors; f++) {
            x0.push(ax + (bx - ax) * t0);
            y0.push(ay + (by - ay) * t0);
            x1.push(ax + (bx - ax) * t1);
            y1.push(ay + (by - ay) * t1);
            z0.push(b.base + f * fh);
            z1.push(b.base + (f + 1) * fh);
            building.push(b.index);
            floor.push(f);
            wall.push(w);
          }
        }
      }
    }
  }

  return {
    count: building.length,
    x0: Float32Array.from(x0),
    y0: Float32Array.from(y0),
    x1: Float32Array.from(x1),
    y1: Float32Array.from(y1),
    z0: Float32Array.from(z0),
    z1: Float32Array.from(z1),
    building: Uint32Array.from(building),
    floor: Uint16Array.from(floor),
    wall: Uint32Array.from(wall),
    wallStart: Uint32Array.from(wallStart),
    wallBays: Uint16Array.from(wallBays),
    wallFloors: Uint16Array.from(wallFloors),
  };
}

/**
 * 窗位网格的指纹（FNV-1a）。预计算结果与浏览器里重建的网格必须逐格对应，
 * 加载时比对指纹，数据管线一改就能发现错位。
 */
export function gridHash(g: WindowGrid): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  mix(g.count);
  for (let i = 0; i < g.count; i += 97) {
    mix(Math.round((g.x0[i] as number) * 100));
    mix(Math.round((g.y0[i] as number) * 100));
    mix(Math.round((g.z0[i] as number) * 100));
    mix(g.building[i] as number);
  }
  return h >>> 0;
}
