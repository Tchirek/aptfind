/**
 * 场景数据加载：district.json + 预计算的大寒日逐窗日照。
 * 以模块级 Promise 暴露，组件里用 React 19 的 use() 读取。
 */

import { type District, loadDistrict } from '../engine/district';
import { buildSolids, buildWindowGrid, gridHash, type WindowGrid } from '../engine/geometry';
import { SunlightEngine } from '../engine/sunlight';

export interface SceneData {
  district: District;
  grid: WindowGrid;
  /** 大寒日每个窗位的日照分钟数 */
  dahanMinutes: Float32Array;
  /** 每栋楼在窗位网格里的区间 [起点, 数量]，没有窗位的楼数量为 0 */
  windowRange: Uint32Array;
}

interface SunlightMeta {
  count: number;
  gridHash: number;
  unit: number;
}

const base = import.meta.env.BASE_URL;

async function load(): Promise<SceneData> {
  const [district, meta, bin] = await Promise.all([
    loadDistrict(`${base}data/district.json`),
    fetch(`${base}data/sunlight-dahan.json`).then((r) => r.json() as Promise<SunlightMeta>),
    fetch(`${base}data/sunlight-dahan.bin`).then((r) => r.arrayBuffer()),
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
  return { district, grid, dahanMinutes, windowRange };
}

export const sceneData: Promise<SceneData> = load();

/** 射线引擎在首次需要时构建（约 0.1 秒），供单个窗位的详细追踪使用 */
let engine: SunlightEngine | null = null;
export async function getEngine(): Promise<SunlightEngine> {
  if (!engine) engine = new SunlightEngine(buildSolids((await sceneData).district.buildings));
  return engine;
}
