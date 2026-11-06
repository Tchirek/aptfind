import { describe, expect, it } from 'vitest';
import type { District } from '../engine/district';
import { buildGazetteer, normalize, search } from './search';

const ring = (x: number, y: number) => Float64Array.of(x, y, x + 10, y, x + 10, y + 10, x, y + 10);

const district = {
  compounds: [
    {
      name: '四川师范大学（狮子山校区）',
      kind: 'school',
      source: 'osm',
      parent: -1,
      builtYear: null,
      rings: [ring(0, 0)],
    },
    {
      name: '桂苑',
      kind: 'residential',
      source: 'derived',
      parent: 0,
      builtYear: null,
      rings: [ring(50, 0)],
    },
    {
      name: '比华利国际城1期',
      kind: 'residential',
      source: 'osm',
      parent: -1,
      builtYear: null,
      rings: [ring(500, 0)],
    },
  ],
  buildings: [
    { index: 0, id: 'a', rings: [ring(5, 5)], label: '图书馆', compound: 0 },
    { index: 1, id: 'b', rings: [ring(6, 6)], label: null, compound: 0 },
  ],
  pois: [
    { name: '狮子山地铁站B口', category: 'metro', x: 100, y: 100 },
    { name: '狮子山地铁站B口', category: 'metro', x: 101, y: 101 },
    { name: '红旗连锁', category: 'grocery', x: 300, y: 0 },
  ],
  roads: [{ name: '静安路', cls: 2, bridge: false, points: Float64Array.of(0, 0, 100, 0) }],
} as unknown as District;

describe('search', () => {
  const g = buildGazetteer(district);

  it('建库：地块、有名字的楼、设施（同名同处去重）、道路', () => {
    expect(g.filter((e) => e.kind === 'compound')).toHaveLength(3);
    expect(g.filter((e) => e.kind === 'building')).toHaveLength(1);
    expect(g.filter((e) => e.kind === 'poi')).toHaveLength(2);
    expect(g.find((e) => e.name === '桂苑')?.detail).toBe('四川师范大学（狮子山校区）');
  });

  it('简称：川师 → 四川师范大学', () => {
    expect(search(g, '川师')[0]?.name).toBe('四川师范大学（狮子山校区）');
  });

  it('楼名与所属地块一起搜', () => {
    const r = search(g, '川师图书馆');
    expect(r[0]?.name).toBe('图书馆');
    expect(r[0]?.building).toBe(0);
  });

  it('前缀优先于包含', () => {
    expect(search(g, '比华利')[0]?.name).toBe('比华利国际城1期');
    const r = search(g, '狮子山');
    expect(r[0]?.name).toBe('狮子山地铁站B口');
    expect(r.some((e) => e.name === '四川师范大学（狮子山校区）')).toBe(true);
  });

  it('全角括号与空格不影响匹配', () => {
    expect(normalize('四川师范大学 （狮子山校区）')).toBe('四川师范大学(狮子山校区)');
    expect(search(g, '静安')[0]?.kind).toBe('road');
    expect(search(g, '')).toEqual([]);
  });
});
