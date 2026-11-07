import { describe, expect, it } from 'vitest';
import { type LivabilityFacts, logRatio, scoreLivability } from './livability';

const good: LivabilityFacts = {
  windows: [300, 320, 280, 260, 300, 320, 290, 310],
  metroMinutes: 4,
  busMinutes: 3,
  groceryMinutes: 3,
  marketMinutes: 5,
  medicalMinutes: 6,
  parkMinutes: 8,
  within10: { grocery: 12, market: 4, food: 40, medical: 8, park: 4 },
  openness: 0.9,
  greenMeters: 60,
  slopePercent: 1,
  roadMeters: 300,
  roadClass: 5,
  builtYear: 2022,
};

const bad: LivabilityFacts = {
  windows: [20, 30, 10, 0, 40, 20, 15, 5],
  metroMinutes: 31,
  busMinutes: Number.POSITIVE_INFINITY,
  groceryMinutes: 24,
  marketMinutes: Number.POSITIVE_INFINITY,
  medicalMinutes: 28,
  parkMinutes: 30,
  within10: { grocery: 0, market: 0, food: 0, medical: 0, park: 0 },
  openness: 0.1,
  greenMeters: 1200,
  slopePercent: 14,
  roadMeters: 5,
  roadClass: 1,
  builtYear: 1985,
};

describe('logRatio', () => {
  it('在 fullAt 处归一为 1，超过也截到 1', () => {
    expect(logRatio(0, 100)).toBe(0);
    expect(logRatio(100, 100)).toBe(1);
    expect(logRatio(10000, 100)).toBe(1);
  });
  it('单调递增', () => {
    const a = logRatio(10, 100);
    const b = logRatio(50, 100);
    expect(a).toBeLessThan(b);
    expect(a).toBeGreaterThan(0);
  });
});

describe('scoreLivability', () => {
  it('同一份输入总是得到同一个分数', () => {
    const a = scoreLivability(good);
    const b = scoreLivability({ ...good });
    expect(a.total).toBe(b.total);
    expect(a.dimensions).toEqual(b.dimensions);
  });

  it('条件好的楼分数高、等级好，且没有扣分', () => {
    const r = scoreLivability(good);
    expect(r.total).toBeGreaterThanOrEqual(85);
    expect(r.tone).toBe('good');
    expect(r.penalties).toHaveLength(0);
    expect(r.dimensions).toHaveLength(5);
  });

  it('条件差的楼分数低，临主干道要扣分且不超过上限', () => {
    const r = scoreLivability(bad);
    expect(r.total).toBeLessThan(45);
    expect(r.tone).toBe('poor');
    const pen = r.penalties.find((p) => p.label === '交通噪声');
    expect(pen).toBeDefined();
    expect(pen?.points).toBeGreaterThan(0);
    expect(pen?.points).toBeLessThanOrEqual(6);
  });

  it('没有窗位时不含采光一项，按其余维度归一', () => {
    const r = scoreLivability({ ...good, windows: [] });
    expect(r.dimensions.some((d) => d.key === 'light')).toBe(false);
    expect(r.dimensions.reduce((s, d) => s + d.max, 0)).toBe(70);
    // 其余维度都好，归一后仍是高分
    expect(r.total).toBeGreaterThanOrEqual(85);
  });

  it('楼龄未知给中位分并写明', () => {
    const r = scoreLivability({ ...good, builtYear: null });
    const age = r.dimensions.find((d) => d.key === 'age');
    expect(age?.score).toBe(8);
    expect(age?.detail).toContain('未知');
  });

  it('每个维度的分数都不超过上限', () => {
    for (const facts of [good, bad, { ...good, windows: [] }]) {
      for (const d of scoreLivability(facts).dimensions) {
        expect(d.score).toBeGreaterThanOrEqual(0);
        expect(d.score).toBeLessThanOrEqual(d.max);
      }
    }
  });

  it('分数总在 0–100 之间', () => {
    for (const facts of [good, bad]) {
      const t = scoreLivability(facts).total;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(100);
    }
  });
});
