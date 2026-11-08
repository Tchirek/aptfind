import { describe, expect, it } from 'vitest';
import { type LivabilityFacts, logRatio, mainFacadeWindows, scoreLivability } from './livability';

const good: LivabilityFacts = {
  windows: [300, 320, 280, 260, 300, 320, 290, 310],
  metroMinutes: 3,
  metroLines: 3,
  busMinutes: 2,
  groceryMinutes: 2,
  marketMinutes: 4,
  hospitalMinutes: 8,
  kindergartenMinutes: 4,
  primaryMinutes: 7,
  middleMinutes: 10,
  within10: { grocery: 15, food: 200, sport: 12 },
  openness: 0.9,
  spacing: 80,
  greenMeters: 60,
  coverage: 0.15,
  roads: [Number.POSITIVE_INFINITY, 300, 300],
  floors: 18,
  builtYear: 2022,
  foodAdjacent: 0,
  property: { fee: 3, green: 45, plotRatio: 2, company: '某物业' },
};

const bad: LivabilityFacts = {
  windows: [20, 30, 10, 0, 40, 20, 15, 5],
  metroMinutes: 31,
  metroLines: 0,
  busMinutes: Number.POSITIVE_INFINITY,
  groceryMinutes: 24,
  marketMinutes: Number.POSITIVE_INFINITY,
  hospitalMinutes: 40,
  kindergartenMinutes: 25,
  primaryMinutes: 30,
  middleMinutes: 40,
  within10: { grocery: 0, food: 0, sport: 0 },
  openness: 0.1,
  spacing: 10,
  greenMeters: 1200,
  coverage: 0.5,
  roads: [20, 5, 5],
  floors: 6,
  builtYear: 1985,
  foodAdjacent: 0,
  property: { fee: 0.8, green: 20, plotRatio: 5, company: null },
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
    expect(r.dimensions).toHaveLength(7);
  });

  it('条件差的楼分数低，临快速路扣得最多且不超过上限', () => {
    const r = scoreLivability(bad);
    expect(r.total).toBeLessThan(45);
    expect(r.tone).toBe('poor');
    const pen = r.penalties.find((p) => p.label === '交通噪声');
    expect(pen?.points).toBeGreaterThan(5);
    expect(pen?.points).toBeLessThanOrEqual(8);
    expect(pen?.detail).toContain('快速路');
  });

  it('只差在低层被挡：较差两成窗位拉低采光分', () => {
    const open = scoreLivability({ ...good, windows: [300, 300, 300, 300, 300] });
    const shaded = scoreLivability({ ...good, windows: [0, 0, 300, 300, 300] });
    const light = (l: typeof open) => l.dimensions.find((d) => d.key === 'light')?.score ?? 0;
    expect(light(open) - light(shaded)).toBeGreaterThan(4);
  });

  it('同样条件下，7 层以上有电梯比 6 层多层分高', () => {
    const b = (f: number) =>
      scoreLivability({ ...good, floors: f }).dimensions.find((d) => d.key === 'building');
    expect((b(18)?.score ?? 0) - (b(6)?.score ?? 0)).toBeCloseTo(3.2, 5);
    expect(b(6)?.facts).toContainEqual({ label: '电梯', value: '无' });
  });

  it('楼间距与周边覆盖率拉开环境分', () => {
    const env = (f: Partial<LivabilityFacts>) =>
      scoreLivability({ ...good, ...f }).dimensions.find((d) => d.key === 'environment')?.score ??
      0;
    expect(env({}) - env({ spacing: 12, coverage: 0.45 })).toBeGreaterThan(6);
  });

  it('没有窗位时不含采光一项，按其余维度归一', () => {
    const r = scoreLivability({ ...good, windows: [] });
    expect(r.dimensions.some((d) => d.key === 'light')).toBe(false);
    expect(r.dimensions.reduce((s, d) => s + d.max, 0)).toBe(78);
    // 其余维度都好，归一后仍是高分
    expect(r.total).toBeGreaterThanOrEqual(85);
  });

  it('楼龄未知给一半并写明', () => {
    const r = scoreLivability({ ...good, builtYear: null });
    const b = r.dimensions.find((d) => d.key === 'building');
    expect(b?.score).toBe(4 + 4);
    expect(b?.detail).toContain('未知');
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

describe('mainFacadeWindows', () => {
  it('只取朝南的窗位，北墙与正东正西不算', () => {
    const r = mainFacadeWindows([300, 0, 200, 0, 0], [180, 0, 130, 90, 270]);
    expect(r.south).toBe(true);
    expect(r.values).toEqual([300, 200]);
  });
  it('没有朝向或没有朝南的墙时退回全部窗位', () => {
    expect(mainFacadeWindows([1, 2], undefined)).toEqual({ values: [1, 2], south: false });
    expect(mainFacadeWindows([1, 2], [0, 10])).toEqual({ values: [1, 2], south: false });
  });
  it('板楼北墙全黑、南墙达标时，采光分不被北墙拖垮', () => {
    const windows = [240, 240, 240, 240, 0, 0, 0, 0];
    const az = [180, 180, 180, 180, 0, 0, 0, 0];
    const withAz = scoreLivability({ ...good, windows, windowAzimuths: az });
    const without = scoreLivability({ ...good, windows });
    const light = (l: typeof withAz) => l.dimensions.find((d) => d.key === 'light')?.score ?? 0;
    expect(light(withAz)).toBeGreaterThan(17);
    expect(light(withAz)).toBeGreaterThan(light(without) + 7);
  });
});

describe('物业与底商', () => {
  it('物业费高、绿化好、容积率低的小区物业分高；查不到的给一半', () => {
    const q = (property: LivabilityFacts['property']) =>
      scoreLivability({ ...good, property }).dimensions.find((d) => d.key === 'quality')?.score ??
      0;
    const top = q({ fee: 3.2, green: 50, plotRatio: 1.3, company: '万科物业' });
    const low = q({ fee: 1, green: 30, plotRatio: 2.8, company: '私人承办' });
    const unknown = q({ fee: null, green: null, plotRatio: null, company: null });
    expect(top).toBeGreaterThan(12);
    expect(low).toBeLessThan(6);
    expect(unknown).toBeCloseTo(7, 5);
  });

  it('楼下一排饭馆扣分，十分钟内餐饮再多也不加分', () => {
    const r = scoreLivability({ ...good, foodAdjacent: 10 });
    expect(r.penalties.find((p) => p.label === '油烟扰民')?.points).toBeCloseTo(3, 5);
    const a = (n: number) =>
      scoreLivability({ ...good, within10: { ...good.within10, food: n } }).dimensions.find(
        (d) => d.key === 'amenity',
      )?.score ?? 0;
    expect(a(300)).toBeCloseTo(a(80), 5);
  });
});

describe('对口小学', () => {
  const education = (facts: LivabilityFacts) =>
    scoreLivability(facts).dimensions.find((d) => d.key === 'education');

  it('查到划片时写校名，按到对口那所的步行时间计分', () => {
    const near = education({ ...good, primarySchool: '菱窠路小学', primaryMinutes: 5 });
    const far = education({ ...good, primarySchool: '菱窠路小学', primaryMinutes: 25 });
    const fact = near?.facts.find((f) => f.label === '对口小学');
    expect(fact?.value).toBe('菱窠路小学 5 分钟');
    expect(fact?.wide).toBe(true);
    expect((near?.score ?? 0) - (far?.score ?? 0)).toBeCloseTo(3.2, 5);
  });

  it('没查到划片时只写步行时间', () => {
    const facts = education({ ...good, primarySchool: null })?.facts ?? [];
    expect(facts.map((f) => f.label)).toEqual(['幼儿园', '小学', '中学']);
  });
});

describe('铁路噪声', () => {
  it('离铁路干线近扣分，计入交通噪声并写明距离', () => {
    const r = scoreLivability({ ...good, railMeters: 50 });
    const noise = r.penalties.find((p) => p.label === '交通噪声');
    expect(noise?.points).toBeCloseTo(4.5, 5);
    expect(noise?.facts[0]).toEqual({ label: '距铁路', value: '50 m' });
  });

  it('与道路取最重的一项，不叠加', () => {
    const r = scoreLivability({ ...good, railMeters: 150, roads: [20, 300, 300] });
    const noise = r.penalties.filter((p) => p.label === '交通噪声');
    expect(noise).toHaveLength(1);
    expect(noise[0]?.facts[0]?.label).toBe('距快速路');
  });
});
