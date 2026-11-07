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

/** 外墙涂料与面砖的常见色，按功能分组，低彩度 */
const WALL_COLORS: Record<number, string[]> = {
  0: ['#eeeae2', '#e6e1d6', '#f1efea', '#e5ddd0', '#ebe5db', '#e0dbd2', '#efe7d9', '#e3e3df'],
  1: ['#e8e1d6', '#e0d6c8', '#ecebe6', '#dcd2c4'],
  2: ['#d8dde1', '#cfd6dc', '#e0e2e2'],
  3: ['#dedcd6', '#d5d3cc'],
};
const ROOF_TINT = new Color('#bebab2');

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
}

export function buildBuildingGeometry(buildings: readonly Building[]): BuildingMesh {
  const pos: number[] = [];
  const facade: number[] = [];
  const color: number[] = [];
  const owner: number[] = [];
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

    for (let k = before; k < pos.length; k += 3) owner.push(b.index);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aFacade', new BufferAttribute(new Float32Array(facade), 4));
  g.setAttribute('color', new BufferAttribute(new Float32Array(color), 3));
  g.setAttribute('aBuilding', new BufferAttribute(Float32Array.from(owner), 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return { geometry: g, vertexBuilding: Uint32Array.from(owner) };
}
