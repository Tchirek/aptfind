/**
 * 地铁乘车：在"车站 × 线路"的状态图上求最早到达时刻。
 *
 * - 同一线路上相邻两站之间按轨道里程 ÷ 线路平均旅行速度计时（速度已含停站）；
 * - 同站不同线路之间换乘，计 transfer 分钟；
 * - 上车时刻由调用方给出（已含走到出入口、进站、候车），本模块只管车上与换乘。
 */

import type { Region, TripParams } from './region';
import { MinHeap } from './walk';

/** 乘车轨迹里的一段：沿某条线从一站坐到相邻一站 */
export interface RideLeg {
  line: number;
  segment: number;
  from: number;
  to: number;
  depart: number;
  arrive: number;
}

export interface RideResult {
  /** 各站最早到达站台的时刻（分钟），到不了为 Infinity */
  arrival: Float64Array;
  /** 最短路树上用到的区间，画乘车轨迹用 */
  legs: RideLeg[];
  /** 到各站最快的那条路依次坐过的线路（换乘几次就有几条），到不了为空 */
  lines: number[][];
}

interface Edge {
  to: number;
  cost: number;
  /** 乘车边的线路与区间；换乘边为 -1 */
  line: number;
  segment: number;
}

export class MetroGraph {
  readonly params: TripParams;
  readonly stationCount: number;
  readonly stationNames: readonly string[];
  /** 状态 = (车站, 线路) */
  private readonly stateStation: number[] = [];
  private readonly statesAt: number[][];
  private readonly adj: Edge[][] = [];

  constructor(region: Region) {
    this.params = region.params;
    this.stationCount = region.stations.length;
    this.stationNames = region.stations.map((s) => s.name);
    this.statesAt = region.stations.map(() => []);
    const ids = new Map<string, number>();
    const state = (station: number, line: number) => {
      const key = `${station}:${line}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = this.stateStation.length;
        ids.set(key, id);
        this.stateStation.push(station);
        this.adj.push([]);
        this.statesAt[station]?.push(id);
      }
      return id;
    };
    region.lines.forEach((line, l) => {
      line.segments.forEach((seg, k) => {
        const a = state(seg.a, l);
        const b = state(seg.b, l);
        const cost = seg.length / line.speed;
        this.adj[a]?.push({ to: b, cost, line: l, segment: k });
        this.adj[b]?.push({ to: a, cost, line: l, segment: k });
      });
    });
    for (const states of this.statesAt) {
      for (const a of states) {
        for (const b of states) {
          if (a !== b)
            this.adj[a]?.push({ to: b, cost: this.params.transfer, line: -1, segment: -1 });
        }
      }
    }
  }

  /**
   * boards[s] 是在 s 站可以上车的时刻（Infinity 表示不在这站上车）。
   * 超过 maxTime 的状态不再展开。
   */
  ride(boards: Float64Array, maxTime = Number.POSITIVE_INFINITY): RideResult {
    const n = this.stateStation.length;
    const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
    const prev = new Int32Array(n).fill(-1);
    const via = new Int32Array(n * 2).fill(-1);
    const heap = new MinHeap();
    boards.forEach((t, s) => {
      if (!Number.isFinite(t) || t > maxTime) return;
      for (const id of this.statesAt[s] ?? []) {
        if (t < (dist[id] as number)) {
          dist[id] = t;
          heap.push(t, id);
        }
      }
    });
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > (dist[u] as number) || d > maxTime) continue;
      for (const e of this.adj[u] ?? []) {
        const nd = d + e.cost;
        if (nd < (dist[e.to] as number)) {
          dist[e.to] = nd;
          prev[e.to] = u;
          via[2 * e.to] = e.line;
          via[2 * e.to + 1] = e.segment;
          heap.push(nd, e.to);
        }
      }
    }

    const arrival = new Float64Array(this.stationCount).fill(Number.POSITIVE_INFINITY);
    const best = new Int32Array(this.stationCount).fill(-1);
    for (let id = 0; id < n; id++) {
      const s = this.stateStation[id] as number;
      const t = dist[id] as number;
      if (t <= maxTime && t < (arrival[s] as number)) {
        arrival[s] = t;
        best[s] = id;
      }
    }

    // 沿最短路树回溯每个站的到达路径，收集用到的乘车区间（去重）
    const seen = new Set<number>();
    const legs: RideLeg[] = [];
    for (let s = 0; s < this.stationCount; s++) {
      for (let id = best[s] as number; id >= 0 && !seen.has(id); id = prev[id] as number) {
        seen.add(id);
        const p = prev[id] as number;
        const line = via[2 * id] as number;
        if (p < 0 || line < 0) continue;
        legs.push({
          line,
          segment: via[2 * id + 1] as number,
          from: this.stateStation[p] as number,
          to: this.stateStation[id] as number,
          depart: dist[p] as number,
          arrive: dist[id] as number,
        });
      }
    }
    legs.sort((a, b) => a.depart - b.depart);

    const lines = Array.from(best, (id) => {
      const seq: number[] = [];
      for (let u = id; u >= 0; u = prev[u] as number) {
        const line = via[2 * u] as number;
        if (line >= 0 && seq[seq.length - 1] !== line) seq.push(line);
      }
      return seq.reverse();
    });
    return { arrival, legs, lines };
  }
}
