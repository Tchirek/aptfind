/**
 * 步行可达：在 OSM 步行网上跑 Dijkstra，给出到各类设施的步行距离与路线。
 *
 * 起点是一栋楼：沿外轮廓每隔几米取一个"门"，各自吸附到最近的路网节点，作为多源最短路的起点；
 * 终点（设施）吸附到最近节点。吸附段按直线距离计入。
 * 步速取 75 m/min（4.5 km/h），台阶按 1.6 倍距离计。
 */

import type { Poi, PoiCategory, WalkNetwork } from './district';

export const WALK_SPEED = 75;
const STEPS_FACTOR = 1.6;
/** 空间哈希的格子边长（米） */
const CELL = 80;

export const minutesOf = (meters: number) => meters / WALK_SPEED;

export class MinHeap {
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

/** 多源最短路的结果：prev 为 -1 的可达节点就是起点之一 */
export interface ShortestPaths {
  dist: Float64Array;
  prev: Int32Array;
}

/** 最短路的起点：路网节点与到达它时已经走过的距离（米） */
export interface Seed {
  node: number;
  dist: number;
}

export class WalkGraph {
  readonly nodeCount: number;
  readonly xy: Float64Array;
  /** 原始边表 [a0, b0, a1, b1, …] 与每条边的通行长度（台阶已加权），画可达范围时逐边使用 */
  readonly edgeNodes: Uint32Array;
  readonly edgeCost: Float32Array;
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
      for (const v of [net.edges[2 * e] as number, net.edges[2 * e + 1] as number])
        degree[v] = (degree[v] as number) + 1;
    }
    this.offsets = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++)
      this.offsets[i + 1] = (this.offsets[i] as number) + (degree[i] as number);
    this.targets = new Uint32Array(2 * m);
    this.weights = new Float32Array(2 * m);
    this.edgeNodes = net.edges;
    this.edgeCost = new Float32Array(m);
    const fill = this.offsets.slice(0, n);
    for (let e = 0; e < m; e++) {
      const a = net.edges[2 * e] as number;
      const b = net.edges[2 * e + 1] as number;
      const len =
        Math.hypot(this.x(a) - this.x(b), this.y(a) - this.y(b)) *
        (net.steps.has(e) ? STEPS_FACTOR : 1);
      this.edgeCost[e] = len;
      const ia = fill[a] as number;
      this.targets[ia] = b;
      this.weights[ia] = len;
      fill[a] = ia + 1;
      const ib = fill[b] as number;
      this.targets[ib] = a;
      this.weights[ib] = len;
      fill[b] = ib + 1;
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
    return this.shortestFrom([{ node: source, dist: 0 }], maxDist);
  }

  /** 多源最短路：每个起点带着初始距离出发，超过 maxDist 的节点不再展开 */
  shortestFrom(seeds: readonly Seed[], maxDist = Number.POSITIVE_INFINITY): ShortestPaths {
    const dist = new Float64Array(this.nodeCount).fill(Number.POSITIVE_INFINITY);
    const prev = new Int32Array(this.nodeCount).fill(-1);
    const heap = new MinHeap();
    for (const s of seeds) {
      if (s.node < 0 || s.dist >= (dist[s.node] as number)) continue;
      dist[s.node] = s.dist;
      heap.push(s.dist, s.node);
    }
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
    return { dist, prev };
  }

  /** 沿最短路树从 target 回溯到起点：返回节点序列（起点在前） */
  pathTo(sp: ShortestPaths, target: number): number[] {
    const nodes: number[] = [];
    if (!Number.isFinite(sp.dist[target] as number)) return nodes;
    for (let v = target; v >= 0; v = sp.prev[v] as number) nodes.push(v);
    return nodes.reverse();
  }

  /** 从起点到 target 的折线 [x0, y0, x1, y1, …] */
  route(sp: ShortestPaths, target: number): Float64Array {
    const nodes = this.pathTo(sp, target);
    const out = new Float64Array(nodes.length * 2);
    nodes.forEach((v, k) => {
      out[2 * k] = this.x(v);
      out[2 * k + 1] = this.y(v);
    });
    return out;
  }
}

/** 楼的出入口：外轮廓上的点，吸附到某个路网节点 */
export interface Door extends Seed {
  x: number;
  y: number;
}

/**
 * 沿楼的外轮廓每隔 spacing 米取一个点作为出入口，各自吸附到最近的路网节点；
 * 同一节点只留最近的那个点。没有路网数据时（比如离路太远）返回空表。
 */
export function buildingDoors(
  graph: WalkGraph,
  outer: Float64Array,
  spacing = 8,
  maxSnap = 150,
): Door[] {
  const best = new Map<number, Door>();
  const n = outer.length / 2;
  const offer = (x: number, y: number) => {
    const { node, distance } = graph.nearest(x, y);
    if (node < 0 || distance > maxSnap) return;
    const prev = best.get(node);
    if (!prev || distance < prev.dist) best.set(node, { node, dist: distance, x, y });
  };
  for (let i = 0; i < n; i++) {
    const ax = outer[2 * i] as number;
    const ay = outer[2 * i + 1] as number;
    const bx = outer[2 * ((i + 1) % n)] as number;
    const by = outer[2 * ((i + 1) % n) + 1] as number;
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / spacing));
    for (let j = 0; j < k; j++) offer(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k);
  }
  return [...best.values()];
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
  doors: Door[];
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
  'mcdonalds',
  'starbucks',
  'haidilao',
  'hongqi',
];

/** 从楼的出入口出发到各类设施的步行可达情况；maxMeters 之外不再搜索 */
export function accessFrom(
  graph: WalkGraph,
  pois: readonly SnappedPoi[],
  doors: readonly Door[],
  maxMeters = 2000,
): Access {
  const paths = graph.shortestFrom(doors, maxMeters);
  const categories = CATEGORY_ORDER.map((category): CategoryAccess => {
    let nearest: SnappedPoi | null = null;
    let meters = Number.POSITIVE_INFINITY;
    let within10 = 0;
    for (const p of pois) {
      if (p.poi.category !== category) continue;
      const d = (paths.dist[p.node] as number) + p.snap;
      if (d < meters) {
        meters = d;
        nearest = p;
      }
      if (d <= 10 * WALK_SPEED) within10++;
    }
    return { category, nearest, meters, within10 };
  });
  return { doors: [...doors], paths, categories };
}

/**
 * 从楼走到某个设施的折线：楼的出入口 → 路网 → 设施。
 * 起点落在外轮廓上，所以画出来的线不会从楼里面穿出来。
 */
export function routeToPoi(graph: WalkGraph, access: Access, target: SnappedPoi): Float64Array {
  const nodes = graph.pathTo(access.paths, target.node);
  const first = nodes[0];
  const door = access.doors.find((d) => d.node === first);
  const out: number[] = [];
  if (door) out.push(door.x, door.y);
  for (const v of nodes) out.push(graph.x(v), graph.y(v));
  out.push(target.poi.x, target.poi.y);
  return Float64Array.from(out);
}
