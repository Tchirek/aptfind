import { describe, expect, it } from 'vitest';
import type { Building } from './district';
import { buildSolids, buildWindowGrid, wallAzimuth } from './geometry';
import { SunlightEngine } from './sunlight';
import { viewFrom, viewshedFrom } from './view';

function box(
  index: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  height: number,
): Building {
  return {
    index,
    id: `b${index}`,
    rings: [Float64Array.of(x0, y0, x1, y0, x1, y1, x0, y1)],
    height,
    floors: Math.round(height / 3),
    base: 0,
    cls: 'R',
    source: 'cbmf',
    compound: -1,
    label: null,
    core: index === 0,
  };
}

describe('viewFrom', () => {
  // 目标楼南墙在 y = 0；南面 24 m 处有一栋宽 30 m 的楼
  const buildings = [box(0, -10, 0, 10, 10, 9), box(1, -15, -34, 15, -24, 30)];
  const engine = new SunlightEngine(buildSolids(buildings));
  const grid = buildWindowGrid(buildings);
  const south = [...Array(grid.count).keys()].find(
    (i) => grid.building[i] === 0 && Math.abs(wallAzimuth(grid, i) - 180) < 1,
  ) as number;
  const north = [...Array(grid.count).keys()].find(
    (i) => grid.building[i] === 0 && Math.abs(wallAzimuth(grid, i)) < 1,
  ) as number;

  it('南窗正对面 24 m 是那栋楼，扇面部分被挡', () => {
    const v = viewFrom(engine, grid, south);
    expect(v.frontOwner).toBe(1);
    expect(v.frontDistance).toBeCloseTo(24 - 0.05, 1);
    expect(v.openness).toBeGreaterThan(0.2);
    expect(v.openness).toBeLessThan(0.8);
  });

  it('北窗前方空旷', () => {
    const v = viewFrom(engine, grid, north);
    expect(v.frontDistance).toBeNull();
    expect(v.openness).toBe(1);
  });

  it('视域：正前方水平视线打在对面楼上，北窗水平视线一直看到最远', () => {
    const v = viewshedFrom(engine, grid, south, { step: 5, far: 300 });
    expect(v.dist.length).toBe(v.cols * v.rows);
    const level = Math.round(55 / 5);
    const mid = (v.cols - 1) / 2;
    const k = level * v.cols + mid;
    expect(v.owner[k]).toBe(1);
    expect(v.dist[k]).toBeLessThan(25);
    // 正前方水平方向是朝南
    expect(v.dirs[3 * k + 1]).toBeCloseTo(-1, 5);
    const n = viewshedFrom(engine, grid, north, { step: 5, far: 300 });
    expect(n.owner[level * n.cols + mid]).toBe(-1);
    expect(n.dist[level * n.cols + mid]).toBe(300);
  });
});
