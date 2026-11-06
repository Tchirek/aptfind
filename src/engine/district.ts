/**
 * 场景数据：解码 pipeline/build_district.py 生成的 district.json。
 *
 * 坐标一律是以片区中心为原点的平面坐标（米），x 指东、y 指北、z 指天顶。
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
  U: '未知',
};

/** 楼高来源：遥感反演、实地数层、用户在页面上改过 */
export type HeightSource = 'cbmf' | 'survey' | 'user';

export interface Building {
  index: number;
  id: string;
  /** 第一个是外轮廓（逆时针），其余是内院（顺时针）；每个环为 [x0, y0, x1, y1, …]，不闭合 */
  rings: Float64Array[];
  height: number;
  floors: number;
  cls: BuildingClass;
  source: HeightSource;
  /** 所属小区在 District.compounds 里的下标，-1 表示不在任何已命名小区内 */
  compound: number;
  /** 是否在核心区（只有核心区的楼计算逐窗日照，外圈的楼只作为遮挡物） */
  core: boolean;
}

export interface Compound {
  name: string;
  kind: 'residential' | 'school';
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

export interface District {
  origin: { lat: number; lon: number };
  core: { minX: number; minY: number; maxX: number; maxY: number };
  floorHeight: number;
  attribution: string[];
  buildings: Building[];
  compounds: Compound[];
  roads: Road[];
  water: Water[];
}

interface DistrictJson {
  version: 1;
  origin: { lat: number; lon: number };
  unit: 'dm';
  core: [number, number, number, number];
  floorHeight: number;
  attribution: string[];
  compounds: { n: string; k: 'residential' | 'school'; r: number[][] }[];
  buildings: {
    id: string;
    r: number[][];
    h: number;
    f: number;
    c: BuildingClass;
    s: 'cbmf' | 'survey';
    k?: number;
    core?: 1;
  }[];
  roads: { n: string | null; c: number; b: 0 | 1; p: number[] }[];
  water: ({ r: number[] } | { l: number[]; w: number })[];
}

const DM = 0.1;
const decode = (a: number[]) => Float64Array.from(a, (v) => v * DM);

export function decodeDistrict(json: DistrictJson): District {
  if (json.version !== 1 || json.unit !== 'dm') throw new Error('district.json 版本不受支持');
  const [minX, minY, maxX, maxY] = json.core.map((v) => v * DM) as [number, number, number, number];
  return {
    origin: json.origin,
    core: { minX, minY, maxX, maxY },
    floorHeight: json.floorHeight,
    attribution: json.attribution,
    compounds: json.compounds.map((c) => ({ name: c.n, kind: c.k, rings: c.r.map(decode) })),
    buildings: json.buildings.map((b, index) => ({
      index,
      id: b.id,
      rings: b.r.map(decode),
      height: b.h * DM,
      floors: b.f,
      cls: b.c,
      source: b.s,
      compound: b.k ?? -1,
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
  };
}

export async function loadDistrict(url: string): Promise<District> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ${url} 失败：${res.status}`);
  return decodeDistrict((await res.json()) as DistrictJson);
}
