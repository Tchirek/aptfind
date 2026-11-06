/**
 * 片区内的地点搜索：小区/校园与子片区、有名字的楼、设施、道路。纯本地，不调接口。
 */

import {
  type Building,
  compoundFullName,
  type District,
  type PoiCategory,
} from '../engine/district';

export type SearchKind = 'compound' | 'building' | 'poi' | 'road';

export interface SearchEntry {
  kind: SearchKind;
  name: string;
  /** 第二行说明，如所属小区、设施类别 */
  detail: string;
  /** 平面坐标（米），用于镜头飞过去 */
  x: number;
  y: number;
  building?: number;
  compound?: number;
  category?: PoiCategory;
}

export const POI_LABEL: Record<PoiCategory, string> = {
  metro: '地铁',
  bus: '公交',
  grocery: '超市便利',
  market: '菜市场',
  food: '餐饮',
  medical: '医疗',
  school: '学校',
  park: '公园',
  sport: '运动',
};

const KIND_WEIGHT: Record<SearchKind, number> = {
  compound: 1,
  building: 0.97,
  poi: 0.9,
  road: 0.85,
};

/** 常见简称 → 全称里的写法 */
const ALIASES: [string, string][] = [
  ['川师大', '四川师范大学'],
  ['川师', '四川师范大学'],
  ['师大', '师范大学'],
  ['图书馆', '图书馆'],
];

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[\s·\-—]/g, '');
}

function ringCentroid(ring: Float64Array): [number, number] {
  let x = 0;
  let y = 0;
  const n = ring.length / 2;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i] as number;
    y += ring[i + 1] as number;
  }
  return [x / n, y / n];
}

function ringArea(ring: Float64Array): number {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a +=
      (ring[2 * i] as number) * (ring[2 * j + 1] as number) -
      (ring[2 * j] as number) * (ring[2 * i + 1] as number);
  }
  return Math.abs(a) / 2;
}

export function buildGazetteer(d: District): SearchEntry[] {
  const out: SearchEntry[] = [];
  d.compounds.forEach((c, k) => {
    const largest = [...c.rings].sort((a, b) => b.length - a.length)[0];
    if (!largest) return;
    const [x, y] = ringCentroid(largest);
    const parent = c.parent >= 0 ? d.compounds[c.parent] : undefined;
    out.push({
      kind: 'compound',
      name: c.name,
      detail: parent
        ? parent.name
        : c.kind === 'school'
          ? '学校'
          : c.kind === 'residential'
            ? '小区'
            : '地块',
      x,
      y,
      compound: k,
    });
  });
  // 同一地块里 150 m 内同名的楼（如由几块轮廓组成的图书馆）只收一条，取面积最大的那块
  const labelled: { b: Building; x: number; y: number; area: number }[] = [];
  for (const b of d.buildings) {
    if (!b.label) continue;
    const ring = b.rings[0] as Float64Array;
    const [x, y] = ringCentroid(ring);
    const twin = labelled.find(
      (o) =>
        o.b.label === b.label && o.b.compound === b.compound && Math.hypot(o.x - x, o.y - y) < 150,
    );
    const area = ringArea(ring);
    if (!twin) labelled.push({ b, x, y, area });
    else if (area > twin.area) Object.assign(twin, { b, x, y, area });
  }
  for (const { b, x, y } of labelled) {
    out.push({
      kind: 'building',
      name: b.label as string,
      detail: b.compound >= 0 ? compoundFullName(d, b.compound) : '',
      x,
      y,
      building: b.index,
    });
  }
  const seen = new Set<string>();
  for (const p of d.pois) {
    const key = `${p.name}@${Math.round(p.x / 30)},${Math.round(p.y / 30)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'poi',
      name: p.name,
      detail: POI_LABEL[p.category],
      x: p.x,
      y: p.y,
      category: p.category,
    });
  }
  const roads = new Map<string, Float64Array>();
  for (const r of d.roads) {
    if (!r.name) continue;
    const prev = roads.get(r.name);
    if (!prev || r.points.length > prev.length) roads.set(r.name, r.points);
  }
  for (const [name, pts] of roads) {
    const mid = Math.floor(pts.length / 4) * 2;
    out.push({
      kind: 'road',
      name,
      detail: '道路',
      x: pts[mid] as number,
      y: pts[mid + 1] as number,
    });
  }
  return out;
}

/** 名字里是否按顺序含有查询的每个字 */
function subsequence(hay: string, needle: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

function scoreName(name: string, q: string): number {
  const n = normalize(name);
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80 - Math.min(20, n.length - q.length);
  const at = n.indexOf(q);
  if (at >= 0) return 60 - Math.min(20, at) - Math.min(10, (n.length - q.length) / 2);
  if (q.length >= 2 && subsequence(n, q)) return 25;
  return 0;
}

export function search(entries: readonly SearchEntry[], query: string, limit = 12): SearchEntry[] {
  const q = normalize(query);
  if (!q) return [];
  const variants = [
    q,
    ...ALIASES.filter(([a]) => q.includes(a)).map(([a, full]) => q.replace(a, normalize(full))),
  ];
  const scored: { e: SearchEntry; s: number }[] = [];
  for (const e of entries) {
    let s = 0;
    for (const v of variants) {
      s = Math.max(s, scoreName(e.name, v), 0.6 * scoreName(`${e.detail}${e.name}`, v));
    }
    if (s > 0) scored.push({ e, s: s * KIND_WEIGHT[e.kind] });
  }
  scored.sort((a, b) => b.s - a.s || a.e.name.length - b.e.name.length);
  return scored.slice(0, limit).map((x) => x.e);
}

/** 楼的显示名：单栋名称优先，否则所属地块，再否则"未命名" */
export function buildingTitle(d: District, b: Building): { title: string; subtitle: string } {
  const place = b.compound >= 0 ? compoundFullName(d, b.compound) : '';
  if (b.label) return { title: b.label, subtitle: place };
  return { title: place || '未命名建筑', subtitle: '' };
}
