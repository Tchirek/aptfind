/**
 * 建筑的渲染几何：外墙、内院墙与平屋顶，带上程序化立面需要的属性。
 *
 * 每个顶点的 aFacade = (层坐标, 开间坐标, 离基底的高度, 立面样式)：
 * - 层坐标、开间坐标与 engine/geometry.ts 的逐窗网格完全一致（同样的层数、开间数），
 *   所以立面上画出来的每一扇窗，就是点选时能选中的那一个窗位；
 * - 屋顶的层坐标记为 −1，墙太短（不设窗位）的开间坐标记为 −1。
 * aBuilding 是建筑下标，着色器用它做选中、悬停、挡光高亮与夜里亮灯的随机数种子。
 */

import { BufferAttribute, BufferGeometry, Color, ShapeUtils, Vector2 } from 'three';
import type { Building, BuildingClass } from '../engine/district';
import { BAY_WIDTH, floorsOf, MIN_WALL_LENGTH } from '../engine/geometry';

/** 立面样式：0 住宅（普通窗）· 1 学校、医院、机关（宽窗）· 2 商业（玻璃幕墙）· 3 工业（高窗） */
const STYLE: Record<BuildingClass, number> = {
  R: 0,
  U: 0,
  E: 1,
  M: 1,
  G: 1,
  P: 1,
  C: 2,
  I: 3,
};

/** 外墙色：冷调的白与浅灰蓝，按功能分组，低彩度 */
const WALL_COLORS: Record<number, string[]> = {
  0: ['#eef1f5', '#e4e9f0', '#f3f5f8', '#dfe5ed', '#e9edf3', '#dde3eb', '#edf0f4', '#e3e6ea'],
  1: ['#e5eaf1', '#dbe2eb', '#ebeef2', '#d6dde8'],
  2: ['#d8dde1', '#cfd6dc', '#e0e2e2'],
  3: ['#dde1e7', '#d3d8df'],
};
const ROOF_TINT = new Color('#b4bdc9');

/** 可复现的伪随机：同一栋楼每次加载颜色相同 */
function rand(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface BuildingMesh {
  geometry: BufferGeometry;
  /** 每个顶点所属建筑的下标，拾取时反查 */
  vertexBuilding: Uint32Array;
  /** 每栋楼屋顶的顶点区间 [起点, 个数] */
  roofRange: Uint32Array;
  /** 每栋楼没有评分时的屋顶色 rgb */
  plainRoof: Float32Array;
}

/**
 * 宜居评分 → 屋顶色。五档取真实屋面常见的颜色：砖红（陶瓦）、赤陶、赭黄、橄榄、深绿（种植屋面），
 * 相邻两档色相拉开，彩度压在屋面常见的范围里。
 * 节点不按绝对分数，而按片区里实际分数的 5%、25%、50%、75%、95% 分位（预计算时写进 livability.json），
 * 五档颜色都落在真实存在的楼上，好坏一眼分得开。
 */
export const ROOF_COLORS = ['#9a4e42', '#b27b5b', '#c2a76a', '#8fa064', '#5d895a'] as const;
/** 没有预计算分位时的默认节点 */
export const DEFAULT_ROOF_STOPS = [48, 60, 67, 73, 80] as const;
const ROOF_RAMP = ROOF_COLORS.map((c) => new Color(c));

export function roofColorOf(
  score: number,
  stops: readonly number[] = DEFAULT_ROOF_STOPS,
  out = new Color(),
): Color {
  const n = ROOF_RAMP.length;
  if (score <= (stops[0] as number)) return out.copy(ROOF_RAMP[0] as Color);
  for (let i = 1; i < n; i++) {
    const s1 = stops[i] as number;
    if (score <= s1) {
      const s0 = stops[i - 1] as number;
      const t = s1 > s0 ? (score - s0) / (s1 - s0) : 1;
      return out.copy(ROOF_RAMP[i - 1] as Color).lerp(ROOF_RAMP[i] as Color, t);
    }
  }
  return out.copy(ROOF_RAMP[n - 1] as Color);
}

/** 按某个视角的评分重涂屋顶；分数 −1 的楼用默认屋顶色。只改颜色，不重建网格 */
export function paintRoofs(
  mesh: BuildingMesh,
  scores: Int16Array | undefined,
  stops: readonly number[] | undefined,
): void {
  const attr = mesh.geometry.getAttribute('color') as BufferAttribute;
  const c = new Color();
  const n = mesh.roofRange.length / 2;
  for (let b = 0; b < n; b++) {
    const count = mesh.roofRange[2 * b + 1] as number;
    if (count === 0) continue;
    const score = scores?.[b] ?? -1;
    if (score >= 0) {
      // 同一档里也有一点明暗差，像真实的屋面
      roofColorOf(score, stops, c).multiplyScalar(0.95 + 0.1 * rand(b + 104729));
    } else {
      c.setRGB(
        mesh.plainRoof[3 * b] as number,
        mesh.plainRoof[3 * b + 1] as number,
        mesh.plainRoof[3 * b + 2] as number,
      );
    }
    const start = mesh.roofRange[2 * b] as number;
    for (let v = start; v < start + count; v++) attr.setXYZ(v, c.r, c.g, c.b);
  }
  attr.needsUpdate = true;
}

export function buildBuildingGeometry(buildings: readonly Building[]): BuildingMesh {
  const pos: number[] = [];
  const facade: number[] = [];
  const color: number[] = [];
  const owner: number[] = [];
  const roofRange = new Uint32Array(buildings.length * 2);
  const plainRoof = new Float32Array(buildings.length * 3);
  const wall = new Color();
  const roof = new Color();

  for (const b of buildings) {
    const h = b.height;
    if (h <= 0) continue;
    const floors = floorsOf(h);
    const style = STYLE[b.cls];
    const palette = WALL_COLORS[style] as string[];
    wall.set(palette[Math.floor(rand(b.index) * palette.length)] as string);
    // 同色系里再做一点明暗差，避免一片楼完全同色
    wall.multiplyScalar(0.96 + 0.08 * rand(b.index + 7919));
    roof.copy(wall).lerp(ROOF_TINT, 0.6);
    plainRoof.set([roof.r, roof.g, roof.b], 3 * b.index);
    const z0 = b.base;
    const z1 = b.base + h;
    const before = pos.length;

    const vert = (x: number, y: number, z: number, f: number, k: number, c: Color) => {
      pos.push(x, y, z);
      facade.push(f, k, z - z0, style);
      color.push(c.r, c.g, c.b);
    };

    for (const ring of b.rings) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = ring[2 * i] as number;
        const ay = ring[2 * i + 1] as number;
        const bx = ring[2 * j] as number;
        const by = ring[2 * j + 1] as number;
        const len = Math.hypot(bx - ax, by - ay);
        // 与 buildWindowGrid 相同的开间划分
        const bays = len < MIN_WALL_LENGTH ? -1 : Math.max(1, Math.round(len / BAY_WIDTH));
        const k0 = bays < 0 ? -1 : 0;
        const k1 = bays < 0 ? -1 : bays;
        vert(ax, ay, z0, 0, k0, wall);
        vert(bx, by, z0, 0, k1, wall);
        vert(bx, by, z1, floors, k1, wall);
        vert(ax, ay, z0, 0, k0, wall);
        vert(bx, by, z1, floors, k1, wall);
        vert(ax, ay, z1, floors, k0, wall);
      }
    }

    const [outer, ...holes] = b.rings;
    roofRange[2 * b.index] = pos.length / 3;
    if (outer) {
      const contour: Vector2[] = [];
      for (let i = 0; i < outer.length; i += 2) contour.push(new Vector2(outer[i], outer[i + 1]));
      const holePts = holes.map((r) => {
        const pts: Vector2[] = [];
        for (let i = 0; i < r.length; i += 2) pts.push(new Vector2(r[i], r[i + 1]));
        return pts;
      });
      const all = [contour, ...holePts].flat();
      for (const tri of ShapeUtils.triangulateShape(contour, holePts)) {
        const [p, q, r] = tri.map((k) => all[k] as Vector2) as [Vector2, Vector2, Vector2];
        const ccw = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) > 0;
        const [s, t] = ccw ? [q, r] : [r, q];
        for (const v of [p, s, t]) vert(v.x, v.y, z1, -1, -1, roof);
      }
    }
    roofRange[2 * b.index + 1] = pos.length / 3 - (roofRange[2 * b.index] as number);

    for (let k = before; k < pos.length; k += 3) owner.push(b.index);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aFacade', new BufferAttribute(new Float32Array(facade), 4));
  g.setAttribute('color', new BufferAttribute(new Float32Array(color), 3));
  g.setAttribute('aBuilding', new BufferAttribute(Float32Array.from(owner), 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return { geometry: g, vertexBuilding: Uint32Array.from(owner), roofRange, plainRoof };
}
