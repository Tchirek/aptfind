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
}

/**
 * 宜居评分 → 屋顶色。取真实屋面常见的颜色：差的是砖红（陶瓦），中等是赭黄，
 * 好的是橄榄到苔绿（种植屋面）；明度沿色阶变化，红绿色弱也分得开。
 * 节点与评分的等级大致对齐：一般 ≤55、中等 70、良好 80、优秀 90。
 */
const ROOF_RAMP: [number, Color][] = [
  [55, new Color('#9c6656')],
  [70, new Color('#b49a72')],
  [80, new Color('#a2a27c')],
  [90, new Color('#7c9a70')],
];

export function roofColorOf(score: number, out = new Color()): Color {
  const first = ROOF_RAMP[0] as [number, Color];
  const last = ROOF_RAMP[ROOF_RAMP.length - 1] as [number, Color];
  if (score <= first[0]) return out.copy(first[1]);
  if (score >= last[0]) return out.copy(last[1]);
  for (let i = 1; i < ROOF_RAMP.length; i++) {
    const [s1, c1] = ROOF_RAMP[i] as [number, Color];
    const [s0, c0] = ROOF_RAMP[i - 1] as [number, Color];
    if (score <= s1) return out.copy(c0).lerp(c1, (score - s0) / (s1 - s0));
  }
  return out.copy(last[1]);
}

export function buildBuildingGeometry(
  buildings: readonly Building[],
  /** 每栋楼的宜居评分，−1 表示不着色（用默认屋顶色） */
  scores?: Int16Array,
): BuildingMesh {
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
    const score = scores?.[b.index] ?? -1;
    if (score >= 0) {
      // 同一档里也有一点明暗差，像真实的屋面
      roofColorOf(score, roof).multiplyScalar(0.95 + 0.1 * rand(b.index + 104729));
    } else {
      roof.copy(wall).lerp(ROOF_TINT, 0.6);
    }
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
