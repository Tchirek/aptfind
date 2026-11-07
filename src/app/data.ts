/**
 * 场景数据加载：district.json + 预计算的大寒日逐窗日照。
 * 以模块级 Promise 暴露，组件里用 React 19 的 use() 读取。
 */

import { type District, loadDistrict } from '../engine/district';
import { buildSolids, buildWindowGrid, gridHash, type WindowGrid } from '../engine/geometry';
import type { Entrance } from '../engine/isochrone';
import { MetroGraph } from '../engine/metro';
import { loadRegion, type Region } from '../engine/region';
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
  /** 预计算的宜居评分（核心区住宅），屋顶按它着色；没有为 −1 */
  roofScores: Int16Array;
  /** 屋顶色阶的节点：片区分数的 5%、25%、50%、75%、95% 分位 */
  roofStops: number[] | undefined;
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
          ? (r.json() as Promise<{ gridHash: number; scores: number[]; stops: number[] }>)
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
  const roofScores = new Int16Array(district.buildings.length).fill(-1);
  let roofStops: number[] | undefined;
  if (liv && liv.gridHash === meta.gridHash && liv.scores.length === roofScores.length) {
    roofScores.set(liv.scores);
    roofStops = liv.stops;
  }
  return { district, grid, dahanMinutes, windowRange, roofScores, roofStops };
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
}

let region: Promise<RegionData> | null = null;

/** 区域数据（约 1.3 MB）在场景出来之后再加载，首次调用时开始 */
export function getRegion(): Promise<RegionData> {
  if (!region) {
    region = Promise.all([sceneData, loadRegion(`${base}data/region.json`)]).then(
      ([{ district }, r]) => {
        const graph = new WalkGraph(r.walk);
        return {
          region: r,
          graph,
          metro: new MetroGraph(r),
          entrances: allEntrances(graph, r, district.pois),
          pois: snapPois(graph, district.pois),
        };
      },
    );
  }
  return region;
}
