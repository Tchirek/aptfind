/**
 * 步行可达：在 OSM 步行网上跑 Dijkstra，给出到各类设施的步行距离与路线。
 *
 * 起点、终点各自吸附到最近的路网节点，吸附段按直线距离计入。
 * 步速取 75 m/min（4.5 km/h），台阶按 1.6 倍距离计。
 */

import type { Poi, PoiCategory, WalkNetwork } from './district';

export const WALK_SPEED = 75;
const STEPS_FACTOR = 1.6;
/** 空间哈希的格子边长（米） */
const CELL = 80;

export const minutesOf = (meters: number) => meters / WALK_SPEED;

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((k[p] as number) <= key) break;
      k[i] = k[p] as number;
      v[i] = v[p] as number;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const top: [number, number] = [k[0] as number, v[0] as number];
    const lastK = k.pop() as number;
    const lastV = v.pop() as number;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= k.length) break;
        const r = l + 1;
        const c = r < k.length && (k[r] as number) < (k[l] as number) ? r : l;
        if ((k[c] as number) >= lastK) break;
        k[i] = k[c] as number;
        v[i] = v[c] as number;
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

export interface ShortestPaths {
  source: number;
  dist: Float64Array;
  prev: Int32Array;
}

export class WalkGraph {
  readonly nodeCount: number;
  readonly xy: Float64Array;
  private readonly offsets: Uint32Array;
  private readonly targets: Uint32Array;
  private readonly weights: Float32Array;
  private readonly cells = new Map<string, number[]>();

  constructor(net: WalkNetwork) {
    this.xy = net.nodes;
    const n = net.nodes.length / 2;
    this.nodeCount = n;
    const m = net.edges.length / 2;
    const degree = new Uint32Array(n);
    for (let e = 0; e < m; e++) {
      degree[net.edges[2 * e] as number]++;
      degree[net.edges[2 * e + 1] as number]++;
    }
    this.offsets = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) this.offsets[i + 1] = (this.offsets[i] as number) + (degree[i] as number);
    this.targets = new Uint32Array(2 * m);
    this.weights = new Float32Array(2 * m);
    const fill = this.offsets.slice(0, n);
    for (let e = 0; e < m; e++) {
      const a = net.edges[2 * e] as number;
      const b = net.edges[2 * e + 1] as number;
      const len =
        Math.hypot(this.x(a) - this.x(b), this.y(a) - this.y(b)) * (net.steps.has(e) ? STEPS_FACTOR : 1);
      this.targets[fill[a] as number] = b;
      this.weights[fill[a] as number] = len;
      fill[a]++;
      this.targets[fill[b] as number] = a;
      this.weights[fill[b] as number] = len;
      fill[b]++;
    }
    for (let i = 0; i < n; i++) {
      const key = this.cellKey(this.x(i), this.y(i));
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    }
  }

  x(i: number): number {
    return this.xy[2 * i] as number;
  }

  y(i: number): number {
    return this.xy[2 * i + 1] as number;
  }

  private cellKey(x: number, y: number): string {
    return `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  }

  /** 最近的路网节点；逐圈扩大搜索，直到这一圈之外不可能更近 */
  nearest(x: number, y: number): { node: number; distance: number } {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let r = 0; r < 40; r++) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cy - r; j <= cy + r; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
          for (const k of this.cells.get(`${i},${j}`) ?? []) {
            const d = Math.hypot(this.x(k) - x, this.y(k) - y);
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
        }
      }
      if (best >= 0 && bestD <= r * CELL) break;
    }
    return { node: best, distance: bestD };
  }

  /** 从 source 出发的最短路，超过 maxDist 的节点不再展开 */
  shortest(source: number, maxDist = Number.POSITIVE_INFINITY): ShortestPaths {
    const dist = new Float64Array(this.nodeCount).fill(Number.POSITIVE_INFINITY);
    const prev = new Int32Array(this.nodeCount).fill(-1);
    const heap = new MinHeap();
    dist[source] = 0;
    heap.push(0, source);
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > (dist[u] as number) || d > maxDist) continue;
      for (let e = this.offsets[u] as number; e < (this.offsets[u + 1] as number); e++) {
        const v = this.targets[e] as number;
        const nd = d + (this.weights[e] as number);
        if (nd < (dist[v] as number)) {
          dist[v] = nd;
          prev[v] = u;
          heap.push(nd, v);
        }
      }
    }
    // 超出范围的节点只拿到了暂定距离（上界，未必最短），一律记为不可达
    if (Number.isFinite(maxDist)) {
      for (let i = 0; i < this.nodeCount; i++) {
        if ((dist[i] as number) > maxDist) {
          dist[i] = Number.POSITIVE_INFINITY;
          prev[i] = -1;
        }
      }
    }
    return { source, dist, prev };
  }

  /** 从起点到 target 的折线 [x0, y0, x1, y1, …] */
  route(sp: ShortestPaths, target: number): Float64Array {
    const nodes: number[] = [];
    for (let v = target; v >= 0; v = sp.prev[v] as number) {
      nodes.push(v);
      if (v === sp.source) break;
    }
    nodes.reverse();
    const out = new Float64Array(nodes.length * 2);
    nodes.forEach((v, k) => {
      out[2 * k] = this.x(v);
      out[2 * k + 1] = this.y(v);
    });
    return out;
  }
}

/** 设施吸附到路网后的索引 */
export interface SnappedPoi {
  poi: Poi;
  node: number;
  snap: number;
}

export function snapPois(graph: WalkGraph, pois: readonly Poi[]): SnappedPoi[] {
  return pois.map((poi) => {
    const { node, distance } = graph.nearest(poi.x, poi.y);
    return { poi, node, snap: distance };
  });
}

export interface CategoryAccess {
  category: PoiCategory;
  /** 步行最近的一处 */
  nearest: SnappedPoi | null;
  meters: number;
  /** 步行 10 分钟内的数量 */
  within10: number;
}

export interface Access {
  origin: { x: number; y: number; node: number; snap: number };
  paths: ShortestPaths;
  categories: CategoryAccess[];
}

export const CATEGORY_ORDER: PoiCategory[] = [
  'metro',
  'bus',
  'grocery',
  'market',
  'food',
  'medical',
  'park',
  'sport',
  'school',
];

/** 从 (x, y) 出发到各类设施的步行可达情况；maxMeters 之外不再搜索 */
export function accessFrom(
  graph: WalkGraph,
  pois: readonly SnappedPoi[],
  x: number,
  y: number,
  maxMeters = 2000,
): Access {
  const { node, distance: snap } = graph.nearest(x, y);
  const paths = graph.shortest(node, maxMeters);
  const categories = CATEGORY_ORDER.map((category): CategoryAccess => {
    let nearest: SnappedPoi | null = null;
    let meters = Number.POSITIVE_INFINITY;
    let within10 = 0;
    for (const p of pois) {
      if (p.poi.category !== category) continue;
      const d = snap + (paths.dist[p.node] as number) + p.snap;
      if (d < meters) {
        meters = d;
        nearest = p;
      }
      if (d <= 10 * WALK_SPEED) within10++;
    }
    return { category, nearest, meters, within10 };
  });
  return { origin: { x, y, node, snap }, paths, categories };
}
