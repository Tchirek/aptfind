import { describe, expect, it } from 'vitest';
import { computeIsochrone, FAR, fieldGrid, rasterizeField, snapEntrances } from './isochrone';
import { MetroGraph } from './metro';
import { polylineLength, type Region } from './region';
import { WalkGraph } from './walk';

/**
 * 两条线：1 号线 A(0,0) — B(1000,0) — C(2000,0)，2 号线 B — D(1000,1000)。
 * 速度 500 m/min，每段 2 分钟；进站候车 5、换乘 5、出站 2，预算 30。
 * 步行网两块互不相连：A 站周边一条东西向的路（x = −300…300，每 100 m 一个节点），
 * C 站周边同样一条（x = 1700…2300）。
 */
function seg(a: number, b: number, pts: number[]) {
  const points = Float64Array.from(pts);
  return { a, b, points, length: polylineLength(points) };
}

const nodes: number[] = [];
for (let x = -300; x <= 300; x += 100) nodes.push(x, 0);
for (let x = 1700; x <= 2300; x += 100) nodes.push(x, 0);
const edges: number[] = [];
for (let i = 0; i < 6; i++) edges.push(i, i + 1);
for (let i = 7; i < 13; i++) edges.push(i, i + 1);

const region: Region = {
  params: { budget: 30, walkSpeed: 75, board: 5, transfer: 5, exit: 2 },
  stations: [
    { name: 'A', x: 0, y: 0, entrances: Float64Array.of(0, 0) },
    { name: 'B', x: 1000, y: 0, entrances: Float64Array.of(1000, 0) },
    { name: 'C', x: 2000, y: 0, entrances: Float64Array.of(2000, 0) },
    { name: 'D', x: 1000, y: 1000, entrances: Float64Array.of(1000, 1000) },
  ],
  lines: [
    {
      ref: '1',
      name: '1号线',
      colour: '#000',
      speed: 500,
      segments: [seg(0, 1, [0, 0, 1000, 0]), seg(1, 2, [1000, 0, 2000, 0])],
    },
    {
      ref: '2',
      name: '2号线',
      colour: '#000',
      speed: 500,
      segments: [seg(1, 3, [1000, 0, 1000, 1000])],
    },
  ],
  walk: { nodes: Float64Array.from(nodes), edges: Uint32Array.from(edges), steps: new Set() },
  basemap: { roads: [], water: [] },
};

describe('MetroGraph', () => {
  const metro = new MetroGraph(region);

  it('沿线计时，换乘加 5 分钟', () => {
    const boards = Float64Array.of(
      5,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const r = metro.ride(boards);
    expect(Array.from(r.arrival)).toEqual([5, 7, 9, 14]);
    // 到 D：A→B（1 号线）、B→D（2 号线）；到 C：A→B、B→C
    const legs = r.legs.map((l) => `${l.from}-${l.to}@${l.depart}-${l.arrive}`).sort();
    expect(legs).toEqual(['0-1@5-7', '1-2@7-9', '1-3@12-14']);
  });

  it('超过 maxTime 的站到不了', () => {
    const boards = Float64Array.of(
      5,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const r = metro.ride(boards, 10);
    expect(r.arrival[3]).toBe(Number.POSITIVE_INFINITY);
    expect(r.arrival[2]).toBe(9);
  });
});

describe('computeIsochrone', () => {
  const graph = new WalkGraph(region.walk);
  const metro = new MetroGraph(region);
  const entrances = snapEntrances(graph, region);
  // 楼的出入口在 x = −100 处
  const doors = [{ node: 2, dist: 0, x: -100, y: 0 }];
  const iso = computeIsochrone(graph, metro, entrances, doors);

  it('只步行：按步速计时，另一块路网到不了', () => {
    expect(iso.walk[2]).toBe(0);
    expect(iso.walk[6]).toBeCloseTo(400 / 75, 5);
    expect(iso.walk[10]).toBe(Number.POSITIVE_INFINITY);
  });

  it('步行 + 地铁：走到 A 站 → 坐到 C 站 → 出站后继续走', () => {
    // 走到 A 出入口 100 m（1.33 分）+ 进站 5 + 坐两站 4 + 出站 2 = 12.33 分到 C 站地面
    const atC = 100 / 75 + 5 + 4 + 2;
    expect(iso.combined[10]).toBeCloseTo(atC, 5);
    expect(iso.combined[13]).toBeCloseTo(atC + 300 / 75, 5);
    expect(iso.stations.map((s) => region.stations[s.station]?.name)).toEqual(['B', 'C', 'D']);
    // 步行能到的地方，两种算法一致
    expect(iso.combined[6]).toBeCloseTo(iso.walk[6] as number, 5);
  });

  it('到达时刻场：路上等于节点时刻，离路越远越晚，不连通处为 FAR', () => {
    const grid = fieldGrid(graph, iso.combined, 30, { margin: 50, maxCells: 400, minCell: 10 });
    expect(grid).not.toBeNull();
    if (!grid) return;
    const field = rasterizeField(graph, iso, grid, 75);
    const at = (x: number, y: number, c: 0 | 1) => {
      const i = Math.floor((x - grid.x0) / grid.cell);
      const j = Math.floor((y - grid.y0) / grid.cell);
      return field[(j * grid.nx + i) * 2 + c] as number;
    };
    expect(at(-100, 0, 0)).toBeLessThan(0.2);
    expect(at(-100, 40, 0)).toBeGreaterThan(at(-100, 0, 0) + 0.5);
    expect(at(2000, 0, 1)).toBeCloseTo(100 / 75 + 11, 0);
    // C 站那块只有坐地铁才到得了
    expect(at(2000, 0, 0)).toBeGreaterThan(30);
    expect(FAR).toBeGreaterThan(30);
  });
});
