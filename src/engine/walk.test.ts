import { describe, expect, it } from 'vitest';
import type { Poi, WalkNetwork } from './district';
import { accessFrom, snapPois, WALK_SPEED, WalkGraph } from './walk';

/**
 * 一个"日"字形路网：
 *   3 —— 4 —— 5
 *   |         |
 *   0 —— 1 —— 2
 * 横边 100 m，竖边 50 m；1→4 之间没有路，0→3 是台阶
 */
const net: WalkNetwork = {
  nodes: Float64Array.of(0, 0, 100, 0, 200, 0, 0, 50, 100, 50, 200, 50),
  edges: Uint32Array.of(0, 1, 1, 2, 3, 4, 4, 5, 0, 3, 2, 5),
  steps: new Set([4]),
};

describe('WalkGraph', () => {
  const g = new WalkGraph(net);

  it('最近节点', () => {
    expect(g.nearest(95, 8)).toEqual({ node: 1, distance: Math.hypot(5, 8) });
    expect(g.nearest(260, 60).node).toBe(5);
  });

  it('最短路绕开没有路的地方，台阶按 1.6 倍计', () => {
    const sp = g.shortest(1);
    // 1→4：1→0→3→4 = 100 + 80 + 100 = 280；1→2→5→4 = 100 + 50 + 100 = 250
    expect(sp.dist[4]).toBeCloseTo(250, 6);
    expect(Array.from(g.route(sp, 4))).toEqual([100, 0, 200, 0, 200, 50, 100, 50]);
  });

  it('超出 maxDist 的节点不展开', () => {
    const sp = g.shortest(0, 120);
    expect(sp.dist[2]).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('accessFrom', () => {
  const g = new WalkGraph(net);
  const pois: Poi[] = [
    { name: '超市甲', category: 'grocery', x: 205, y: 55 },
    { name: '超市乙', category: 'grocery', x: 0, y: 60 },
    { name: '地铁 A 口', category: 'metro', x: 100, y: -4 },
  ];
  const snapped = snapPois(g, pois);

  it('取步行距离最近的一处，并计入两端吸附距离', () => {
    const a = accessFrom(g, snapped, 98, 0);
    const grocery = a.categories.find((c) => c.category === 'grocery');
    // 起点吸附 2 m；到乙：1→0→3 = 100 + 80，吸附 10 m；到甲：1→2→5 = 150，吸附 √50
    expect(grocery?.nearest?.poi.name).toBe('超市甲');
    expect(grocery?.meters).toBeCloseTo(2 + 150 + Math.SQRT2 * 5, 6);
    expect(grocery?.within10).toBe(2);
    const metro = a.categories.find((c) => c.category === 'metro');
    expect(metro?.meters).toBeCloseTo(2 + 4, 6);
    expect(WALK_SPEED).toBe(75);
  });

  it('没有的类别返回空', () => {
    const a = accessFrom(g, snapped, 0, 0);
    expect(a.categories.find((c) => c.category === 'park')?.nearest).toBeNull();
  });
});
