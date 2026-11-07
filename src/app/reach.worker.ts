/**
 * 可达范围的计算放在 Worker 里：两次多源最短路、地铁换乘、两张到达时刻场的扩散，
 * 合计约 0.2 秒，放主线程会让镜头飞行卡一下。
 * Worker 自己加载 region.json、建图；主线程只把楼的外轮廓发过来，拿回可直接上传的半精度纹理。
 */

import * as Comlink from 'comlink';
import { DataUtils } from 'three';
import { Barriers } from '../engine/barriers';
import {
  computeIsochrone,
  type Entrance,
  type FieldGrid,
  fieldGrid,
  rasterizeField,
  reachableArea,
  snapEntrances,
  waterMask,
} from '../engine/isochrone';
import { MetroGraph } from '../engine/metro';
import { loadRegion, type Region } from '../engine/region';
import { buildingDoors, WalkGraph } from '../engine/walk';

/** 半精度纹理里的场：两个通道交错存放 [只步行, 步行 + 地铁]，单位分钟，上限 60 */
export interface PackedField {
  grid: FieldGrid;
  data: Uint16Array;
}

export interface Trail {
  colour: string;
  /** 平面折线 [x0, y0, …] 与各点的到达时刻（分钟） */
  points: Float64Array;
  times: Float32Array;
}

export interface ReachStation {
  name: string;
  x: number;
  y: number;
  exit: number;
  /** 依次乘坐的线路，如 ["7号线", "2号线"]，与各自的标志色 */
  lines: { name: string; colour: string }[];
}

export interface ReachPayload {
  near: PackedField | null;
  far: PackedField | null;
  /** 15 分钟步行、30 分钟步行 + 地铁可达的面积（平方米） */
  area15: number;
  area30: number;
  /** 坐地铁能在 30 分钟内出站的车站 */
  stations: ReachStation[];
  trails: Trail[];
  budget: number;
}

interface State {
  region: Region;
  graph: WalkGraph;
  metro: MetroGraph;
  entrances: Entrance[];
}

let state: Promise<State> | null = null;

/** 场的上限：超出预算很多的地方都按 60 分钟存，插值时等时线附近依然平滑 */
const CAP = 60;

function pack(grid: FieldGrid, field: Float32Array): PackedField {
  const data = new Uint16Array(field.length);
  for (let i = 0; i < field.length; i++) {
    data[i] = DataUtils.toHalfFloat(Math.min(field[i] as number, CAP));
  }
  return { grid, data };
}

const api = {
  /** extraEntrances：片区里来自高德的地铁出入口（站名 + 坐标） */
  init(
    url: string,
    extraEntrances: { station: string; x: number; y: number }[],
    /** 片区里的屏障线段（河、水面、大路），接驳不许穿过 */
    barriers: Float64Array,
  ): Promise<void> {
    state = loadRegion(url).then((region) => {
      const graph = new WalkGraph(region.walk);
      graph.setBarriers(new Barriers(barriers));
      const index = new Map(region.stations.map((s, i) => [s.name, i]));
      const entrances = snapEntrances(graph, region);
      for (const e of extraEntrances) {
        const station = index.get(e.station);
        if (station === undefined) continue;
        const { node, distance } = graph.nearest(e.x, e.y);
        if (node >= 0 && distance <= 250) entrances.push({ station, node, snap: distance });
      }
      return { region, graph, metro: new MetroGraph(region), entrances };
    });
    return state.then(() => undefined);
  },

  async compute(ring: Float64Array, cx: number, cy: number): Promise<ReachPayload> {
    if (!state) throw new Error('reach worker 未初始化');
    const { region, graph, metro, entrances } = await state;
    const speed = region.params.walkSpeed;
    const doors = buildingDoors(graph, ring);
    const iso = computeIsochrone(graph, metro, entrances, doors);
    const budget = iso.budget;

    // 近场：楼周边步行可及的范围，4–5 m 一格；远场：连同各车站周边，至多 1400 格见方
    const nearGrid = fieldGrid(graph, iso.combined, budget, {
      margin: 220,
      maxCells: 1100,
      minCell: 4,
      around: [cx, cy, budget * speed + 300],
    });
    const farGrid = fieldGrid(graph, iso.combined, budget, {
      margin: 400,
      maxCells: 1400,
      minCell: 8,
    });
    // 河道不让可达范围漫过去，过河只能走桥
    const water = region.basemap.water;
    const nearField = nearGrid
      ? rasterizeField(graph, iso, nearGrid, speed, undefined, waterMask(nearGrid, water))
      : null;
    const farField = farGrid
      ? rasterizeField(graph, iso, farGrid, speed, undefined, waterMask(farGrid, water))
      : null;

    const trails: Trail[] = iso.legs.map((leg) => {
      const line = region.lines[leg.line];
      const seg = line?.segments[leg.segment];
      if (!line || !seg)
        return { colour: '#888', points: new Float64Array(), times: new Float32Array() };
      // 区间几何从 a 指向 b；从 b 坐到 a 时反过来
      const forward = seg.a === leg.from;
      const n = seg.points.length / 2;
      const points = new Float64Array(seg.points.length);
      for (let k = 0; k < n; k++) {
        const src = forward ? k : n - 1 - k;
        points[2 * k] = seg.points[2 * src] as number;
        points[2 * k + 1] = seg.points[2 * src + 1] as number;
      }
      const times = new Float32Array(n);
      let acc = 0;
      for (let k = 0; k < n; k++) {
        if (k > 0) {
          acc += Math.hypot(
            (points[2 * k] as number) - (points[2 * k - 2] as number),
            (points[2 * k + 1] as number) - (points[2 * k - 1] as number),
          );
        }
        times[k] = leg.depart + (leg.arrive - leg.depart) * (seg.length > 0 ? acc / seg.length : 1);
      }
      return { colour: line.colour, points, times };
    });

    const payload: ReachPayload = {
      near: nearGrid && nearField ? pack(nearGrid, nearField) : null,
      far: farGrid && farField ? pack(farGrid, farField) : null,
      area15: nearGrid && nearField ? reachableArea(nearField, nearGrid, 0, 15) : 0,
      area30: farGrid && farField ? reachableArea(farField, farGrid, 1, budget) : 0,
      stations: iso.stations.map((s) => {
        const st = region.stations[s.station];
        return {
          name: st?.name ?? '',
          x: st?.x ?? 0,
          y: st?.y ?? 0,
          exit: s.exit,
          lines: s.lines.map((l) => ({
            name: region.lines[l]?.name ?? '',
            colour: region.lines[l]?.colour ?? '#888',
          })),
        };
      }),
      trails: trails.filter((t) => t.times.length > 1),
      budget,
    };
    const transfer: Transferable[] = [];
    if (payload.near) transfer.push(payload.near.data.buffer);
    if (payload.far) transfer.push(payload.far.data.buffer);
    return Comlink.transfer(payload, transfer);
  },
};

export type ReachApi = typeof api;

Comlink.expose(api);
