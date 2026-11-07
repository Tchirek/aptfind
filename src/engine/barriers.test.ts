import { describe, expect, it } from 'vitest';
import { Barriers } from './barriers';
import { WalkGraph } from './walk';

describe('Barriers', () => {
  // 一条南北向的河在 x = 0
  const river = new Barriers(Float64Array.of(0, -100, 0, 100));

  it('穿过河的直线算穿过，终点就在河线上不算', () => {
    expect(river.crosses(-10, 0, 10, 0)).toBe(true);
    expect(river.crosses(-10, 0, -2, 0)).toBe(false);
    expect(river.crosses(-10, 0, 0, 0)).toBe(false);
  });

  it('接驳跳过对岸更近的节点，接到同一侧', () => {
    // 节点：对岸 3 m 处一个，本岸 20 m 处一个
    const g = new WalkGraph({
      nodes: Float64Array.of(3, 0, -25, 0, -25, 10),
      edges: Uint32Array.of(1, 2),
      steps: new Set(),
    });
    expect(g.nearest(-5, 0).node).toBe(0);
    g.setBarriers(river);
    const n = g.nearest(-5, 0);
    expect(n.node).toBe(1);
    expect(n.distance).toBeCloseTo(20, 5);
  });
});
