/**
 * 场景数据加载：district.json + 预计算的大寒日逐窗日照。
 * 以模块级 Promise 暴露，组件里用 React 19 的 use() 读取。
 */

import { Barriers, barrierSegments } from '../engine/barriers';
import { type District, loadDistrict } from '../engine/district';
import { buildSolids, buildWindowGrid, gridHash, type WindowGrid } from '../engine/geometry';
import type { Entrance } from '../engine/isochrone';
import { MetroGraph } from '../engine/metro';
import { PROFILE_KEYS, type ProfileKey } from '../engine/profiles';
import { loadRegion, type Region, stationLines } from '../engine/region';
import { SunlightEngine } from '../engine/sunlight';
import { type SnappedPoi, snapPois, WalkGraph } from '../engine/walk';
import { allEntrances } from './entrances';

export interface SceneData {
  district: District;
  grid: WindowGrid;
  /** 大寒日每个窗位的日照分钟数 */
  dahanMinutes: Float32Array;
  /** 每栋楼在窗位网格里的区间 [起点, 数量]，没有窗位的楼数量为 0 */
  windowRange: Uint32Array;
  /** 各视角预计算的评分（核心区住宅）与屋顶色阶节点；没有的楼分数为 −1 */
  roofs: Partial<Record<ProfileKey, RoofScores>>;
}

export interface RoofScores {
  scores: Int16Array;
  stops: number[];
}

interface SunlightMeta {
  count: number;
  gridHash: number;
  unit: number;
}

const base = import.meta.env.BASE_URL;

async function load(): Promise<SceneData> {
  const [district, meta, bin, liv] = await Promise.all([
    loadDistrict(`${base}data/district.json`),
    fetch(`${base}data/sunlight-dahan.json`).then((r) => r.json() as Promise<SunlightMeta>),
    fetch(`${base}data/sunlight-dahan.bin`).then((r) => r.arrayBuffer()),
    fetch(`${base}data/livability.json`)
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{
              gridHash: number;
              profiles: Record<ProfileKey, { scores: number[]; stops: number[] }>;
            }>)
          : null,
      )
      .catch(() => null),
  ]);
  const grid = buildWindowGrid(district.buildings);
  if (grid.count !== meta.count || gridHash(grid) !== meta.gridHash) {
    throw new Error('预计算的日照结果与窗位网格对不上，请重新运行 npm run data:sunlight');
  }
  const raw = new Uint16Array(bin);
  const dahanMinutes = Float32Array.from(raw, (v) => v * meta.unit);

  const windowRange = new Uint32Array(district.buildings.length * 2);
  for (let i = 0; i < grid.count; i++) {
    const b = grid.building[i] as number;
    if (windowRange[2 * b + 1] === 0) windowRange[2 * b] = i;
    windowRange[2 * b + 1] = (windowRange[2 * b + 1] as number) + 1;
  }
  // 评分与日照出自同一份窗位网格才用，否则屋顶不着色
  const roofs: SceneData['roofs'] = {};
  if (liv && liv.gridHash === meta.gridHash) {
    for (const key of PROFILE_KEYS) {
      const p = liv.profiles[key];
      if (p && p.scores.length === district.buildings.length) {
        roofs[key] = { scores: Int16Array.from(p.scores), stops: p.stops };
      }
    }
  }
  return { district, grid, dahanMinutes, windowRange, roofs };
}

export const sceneData: Promise<SceneData> = load();

/** 射线引擎在首次需要时构建（约 0.1 秒），供单个窗位的详细追踪使用 */
let engine: SunlightEngine | null = null;
export async function getEngine(): Promise<SunlightEngine> {
  if (!engine) {
    const { district } = await sceneData;
    engine = new SunlightEngine(buildSolids(district.buildings, undefined, district.terrain));
  }
  return engine;
}

export { districtEntrances, stationOfPoi } from './entrances';

export interface RegionData {
  region: Region;
  /** 区域步行网：片区外扩 2.6 km 与 30 分钟内可能到达的车站周边 */
  graph: WalkGraph;
  metro: MetroGraph;
  entrances: Entrance[];
  /** 片区设施吸附到步行网 */
  pois: SnappedPoi[];
  /** 每个车站经过的线路 */
  stationLines: number[][];
}

let region: Promise<RegionData> | null = null;

/** 区域数据（约 1.3 MB）在场景出来之后再加载，首次调用时开始 */
export function getRegion(): Promise<RegionData> {
  if (!region) {
    region = Promise.all([sceneData, loadRegion(`${base}data/region.json`)]).then(
      ([{ district }, r]) => {
        const graph = new WalkGraph(r.walk);
        graph.setBarriers(new Barriers(barrierSegments(district)));
        return {
          region: r,
          graph,
          metro: new MetroGraph(r),
          entrances: allEntrances(graph, r, district.pois),
          pois: snapPois(graph, district.pois),
          stationLines: stationLines(r),
        };
      },
    );
  }
  return region;
}
