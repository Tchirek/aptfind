/**
 * 场景数据：解码 pipeline/build_district.py 生成的 district.json（v3）。
 * 步行网与地铁网在 region.json 里（见 region.ts）。
 *
 * 坐标一律是以片区中心为原点的平面坐标（米），x 指东、y 指北、z 指天顶；
 * 高程 z 相对片区最低地面（terrain.base 为其海拔）。
 */

/** 建筑主功能，取自 CBMF 的 class_pred */
export type BuildingClass = 'R' | 'E' | 'C' | 'M' | 'G' | 'P' | 'I' | 'U';

export const CLASS_LABEL: Record<BuildingClass, string> = {
  R: '住宅',
  E: '教育',
  C: '商业',
  M: '医疗',
  G: '政府',
  P: '公共',
  I: '工业',
  U: '其他',
};

/** 楼高来源：遥感反演、OSM 标注的层数、按小区户数与楼栋数推算、实地数层、用户在页面上改过 */
export type HeightSource = 'cbmf' | 'osm' | 'plan' | 'survey' | 'user';

export interface Building {
  index: number;
  id: string;
  /** 第一个是外轮廓（逆时针），其余是内院（顺时针）；每个环为 [x0, y0, x1, y1, …]，不闭合 */
  rings: Float64Array[];
  height: number;
  floors: number;
  /** 基底高程：坡地上取轮廓下最低的地面 */
  base: number;
  cls: BuildingClass;
  source: HeightSource;
  /** 所属小区/校园在 District.compounds 里的下标，-1 表示不属于任何已命名地块 */
  compound: number;
  /** 单栋名称，如"第一教学楼""3栋" */
  label: string | null;
  /** 是否在核心区（只有核心区的楼计算逐窗日照，外圈的楼只作为遮挡物） */
  core: boolean;
}

export type CompoundKind = 'residential' | 'school' | 'other';

export interface Compound {
  name: string;
  kind: CompoundKind;
  /** 边界来自 OSM，或由同名楼群推算 */
  source: 'osm' | 'derived';
  /** 上级地块（如桂苑的上级是川师狮子山校区），-1 表示没有 */
  parent: number;
  builtYear: number | null;
  rings: Float64Array[];
}

export interface Road {
  name: string | null;
  /** 0 快速路/高架 · 1 主干道 · 2 次干道 · 3 支路 · 4 小区道路 · 5 内部通道 */
  cls: number;
  bridge: boolean;
  points: Float64Array;
}

export interface Water {
  ring: Float64Array | null;
  line: Float64Array | null;
  width: number;
}

export type PoiCategory =
  | 'metro'
  | 'bus'
  | 'grocery'
  | 'market'
  | 'food'
  | 'medical'
  | 'school'
  | 'park'
  | 'sport'
  /** 指名标出的连锁品牌 */
  | 'mcdonalds'
  | 'kfc'
  | 'starbucks'
  | 'hema';

export const BRAND_CATEGORIES = ['mcdonalds', 'kfc', 'starbucks', 'hema'] as const;

export interface Poi {
  name: string;
  category: PoiCategory;
  x: number;
  y: number;
}

/** 规则网格地形：z[j·nx + i] 是 (x0 + i·step, y0 + j·step) 处的地面高程 */
export interface Terrain {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  /** z = 0 对应的海拔（米） */
  base: number;
  z: Float32Array;
}

/** 步行网：无向图，节点坐标成对存放，边为节点下标对 */
export interface WalkNetwork {
  nodes: Float64Array;
  edges: Uint32Array;
  /** 台阶边的下标 */
  steps: Set<number>;
}

export interface District {
  origin: { lat: number; lon: number };
  core: { minX: number; minY: number; maxX: number; maxY: number };
  floorHeight: number;
  attribution: string[];
  terrain: Terrain;
  buildings: Building[];
  compounds: Compound[];
  roads: Road[];
  water: Water[];
  pois: Poi[];
}

interface DistrictJson {
  version: 3;
  origin: { lat: number; lon: number };
  unit: 'dm';
  core: [number, number, number, number];
  floorHeight: number;
  attribution: string[];
  terrain: {
    x0: number;
    y0: number;
    step: number;
    nx: number;
    ny: number;
    base: number;
    z: number[];
  };
  compounds: {
    n: string;
    k: CompoundKind;
    o: 'osm' | 'derived';
    p?: number;
    y?: number;
    r: number[][];
  }[];
  buildings: {
    id: string;
    r: number[][];
    h: number;
    f: number;
    z: number;
    c: BuildingClass;
    s: 'cbmf' | 'osm' | 'plan' | 'survey';
    k?: number;
    n?: string;
    core?: 1;
  }[];
  roads: { n: string | null; c: number; b: 0 | 1; p: number[] }[];
  water: ({ r: number[] } | { l: number[]; w: number })[];
  pois: { n: string; c: PoiCategory; p: [number, number] }[];
}

const DM = 0.1;
const decode = (a: number[]) => Float64Array.from(a, (v) => v * DM);

export function decodeDistrict(json: DistrictJson): District {
  if (json.version !== 3 || json.unit !== 'dm') throw new Error('district.json 版本不受支持');
  const [minX, minY, maxX, maxY] = json.core.map((v) => v * DM) as [number, number, number, number];
  const t = json.terrain;
  return {
    origin: json.origin,
    core: { minX, minY, maxX, maxY },
    floorHeight: json.floorHeight,
    attribution: json.attribution,
    terrain: {
      x0: t.x0 * DM,
      y0: t.y0 * DM,
      step: t.step * DM,
      nx: t.nx,
      ny: t.ny,
      base: t.base,
      z: Float32Array.from(t.z, (v) => v * DM),
    },
    compounds: json.compounds.map((c) => ({
      name: c.n,
      kind: c.k,
      source: c.o,
      parent: c.p ?? -1,
      builtYear: c.y ?? null,
      rings: c.r.map(decode),
    })),
    buildings: json.buildings.map((b, index) => ({
      index,
      id: b.id,
      rings: b.r.map(decode),
      height: b.h * DM,
      floors: b.f,
      base: b.z * DM,
      cls: b.c,
      source: b.s,
      compound: b.k ?? -1,
      label: b.n ?? null,
      core: b.core === 1,
    })),
    roads: json.roads.map((r) => ({
      name: r.n,
      cls: r.c,
      bridge: r.b === 1,
      points: decode(r.p),
    })),
    water: json.water.map((w) =>
      'r' in w
        ? { ring: decode(w.r), line: null, width: 0 }
        : { ring: null, line: decode(w.l), width: w.w },
    ),
    pois: json.pois.map((p) => ({ name: p.n, category: p.c, x: p.p[0] * DM, y: p.p[1] * DM })),
  };
}

export async function loadDistrict(url: string): Promise<District> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ${url} 失败：${res.status}`);
  return decodeDistrict((await res.json()) as DistrictJson);
}

/** 地面高程，双线性插值，越界取边缘值 */
export function terrainAt(t: Terrain, x: number, y: number): number {
  const fx = Math.min(Math.max((x - t.x0) / t.step, 0), t.nx - 1.000001);
  const fy = Math.min(Math.max((y - t.y0) / t.step, 0), t.ny - 1.000001);
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const z = (a: number, b: number) => t.z[b * t.nx + a] as number;
  return (
    z(i, j) * (1 - tx) * (1 - ty) +
    z(i + 1, j) * tx * (1 - ty) +
    z(i, j + 1) * (1 - tx) * ty +
    z(i + 1, j + 1) * tx * ty
  );
}

/** 地块的全称：子片区带上上级，如"四川师范大学（狮子山校区）· 桂苑" */
export function compoundFullName(d: District, k: number): string {
  const c = d.compounds[k];
  if (!c) return '';
  const p = c.parent >= 0 ? d.compounds[c.parent] : undefined;
  return p ? `${p.name} · ${c.name}` : c.name;
}
