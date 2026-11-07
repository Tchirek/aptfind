import { describe, expect, it } from 'vitest';
import type { District, Road, Terrain } from './district';
import { distanceToPolyline, greenDistance, nearestRoad, slopePercent } from './site';

function terrain(z: (x: number, y: number) => number): Terrain {
  const nx = 41;
  const ny = 41;
  const step = 10;
  const x0 = -200;
  const y0 = -200;
  const grid = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) grid[j * nx + i] = z(x0 + i * step, y0 + j * step);
  }
  return { x0, y0, step, nx, ny, base: 500, z: grid };
}

function district(patch: Partial<District> = {}): District {
  return {
    origin: { lat: 30.616, lon: 104.12 },
    core: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    floorHeight: 3,
    attribution: [],
    terrain: terrain(() => 0),
    buildings: [],
    compounds: [],
    roads: [],
    water: [],
    pois: [],
    ...patch,
  };
}

describe('distanceToPolyline', () => {
  it('取到折线的最近距离', () => {
    const line = Float64Array.from([0, 0, 100, 0]);
    expect(distanceToPolyline(50, 20, line)).toBeCloseTo(20);
    expect(distanceToPolyline(-10, 0, line)).toBeCloseTo(10);
    expect(distanceToPolyline(120, 0, line)).toBeCloseTo(20);
  });

  it('单点折线退化为点距', () => {
    expect(distanceToPolyline(3, 4, Float64Array.from([0, 0]))).toBeCloseTo(5);
  });
});

describe('nearestRoad', () => {
  const roads: Road[] = [
    {
      name: '主干道',
      cls: 1,
      bridge: false,
      lanes: null,
      oneway: 0,
      points: Float64Array.from([0, 0, 200, 0]),
    },
    {
      name: '支路',
      cls: 3,
      bridge: false,
      lanes: null,
      oneway: 0,
      points: Float64Array.from([50, 20, 50, 100]),
    },
  ];

  it('只考虑主干道等级，忽略更远的支路', () => {
    const r = nearestRoad(roads, 50, 10);
    expect(r?.cls).toBe(1);
    expect(r?.meters).toBeCloseTo(10);
  });

  it('超出探测范围返回 null', () => {
    expect(nearestRoad(roads, 50, 900)).toBeNull();
  });
});

describe('slopePercent', () => {
  it('平地坡度为 0', () => {
    expect(slopePercent(district(), 0, 0)).toBeCloseTo(0);
  });

  it('沿 x 方向 5% 的坡能测出来', () => {
    const d = district({ terrain: terrain((x) => x * 0.05) });
    expect(slopePercent(d, 0, 0)).toBeCloseTo(5, 1);
  });
});

describe('greenDistance', () => {
  it('河道扣掉半宽，站在岸边算 0', () => {
    const d = district({
      water: [{ ring: null, line: Float64Array.from([-100, 0, 100, 0]), width: 20 }],
    });
    expect(greenDistance(d, 0, 5)).toBe(0);
    expect(greenDistance(d, 0, 30)).toBeCloseTo(20);
  });

  it('公园按 100 m 半径折算', () => {
    const d = district({ pois: [{ name: '公园', category: 'park', x: 400, y: 0 }] });
    expect(greenDistance(d, 0, 0)).toBeCloseTo(300);
    expect(greenDistance(d, 350, 0)).toBe(0);
  });

  it('水面按闭合岸线算', () => {
    const ring = Float64Array.from([0, 0, 100, 0, 100, 100, 0, 100]);
    const d = district({ water: [{ ring, line: null, width: 0 }] });
    expect(greenDistance(d, 50, 90)).toBeCloseTo(10);
  });
});
