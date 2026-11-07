/**
 * 宜居评分与二手房均价对拍：各小区住宅楼的评分中位数，与公开挂牌均价的秩相关。
 * 均价取自安居客、房天下、链家的小区页（口径与日期不一，只用来看排序）。
 * 用法：npx tsx scripts/score-vs-price.ts
 */
import { readFileSync } from 'node:fs';
import { allEntrances } from '../src/app/entrances';
import { livabilityOf } from '../src/app/livabilityFacts';
import { Barriers, barrierSegments } from '../src/engine/barriers';
import { decodeDistrict } from '../src/engine/district';
import { buildSolids, buildWindowGrid } from '../src/engine/geometry';
import { MetroGraph } from '../src/engine/metro';
import { decodeRegion, stationLines } from '../src/engine/region';
import { SunlightEngine } from '../src/engine/sunlight';
import { snapPois, WalkGraph } from '../src/engine/walk';

/** 元/㎡；多个平台时取近期主流的中间值 */
export const PRICES: Record<string, number> = {
  万科·城市花园: 28000,
  华润幸福里2期: 26900,
  比华利国际城3期: 25550,
  万科金润华府: 25200,
  比华利国际城2期: 22900,
  华润·凯旋天地: 21000,
  望江锦园: 19900,
  比华利国际城1期: 19200,
  锦江国际花园: 18100,
  沙河壹号2期: 17600,
  校园春天: 17400,
  蓝谷地A区: 17200,
  城东雅郡: 16800,
  海桐一期: 13900,
  嘉和园一期: 12400,
  嘉和园二期: 12450,
};

const DATA = new URL('../public/data/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DATA));
const district = decodeDistrict(JSON.parse(read('district.json').toString('utf8')));
const region = decodeRegion(JSON.parse(read('region.json').toString('utf8')));
const meta = JSON.parse(read('sunlight-dahan.json').toString('utf8'));
const grid = buildWindowGrid(district.buildings);
const bin = read('sunlight-dahan.bin');
const raw = new Uint16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2);
const dahanMinutes = Float32Array.from(raw, (v) => v * meta.unit);
const windowRange = new Uint32Array(district.buildings.length * 2);
for (let i = 0; i < grid.count; i++) {
  const b = grid.building[i] as number;
  if (windowRange[2 * b + 1] === 0) windowRange[2 * b] = i;
  windowRange[2 * b + 1] = (windowRange[2 * b + 1] as number) + 1;
}
const engine = new SunlightEngine(buildSolids(district.buildings, undefined, district.terrain));
const graph = new WalkGraph(region.walk);
graph.setBarriers(new Barriers(barrierSegments(district)));
const ctx = {
  district,
  grid,
  dahanMinutes,
  windowRange,
  engine,
  graph,
  pois: snapPois(graph, district.pois),
  metro: new MetroGraph(region),
  entrances: allEntrances(graph, region, district.pois),
  stationLines: stationLines(region),
};

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s[Math.floor(s.length / 2)] as number) : Number.NaN;
};
const rank = (a: number[]) => {
  const idx = a.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  const r = new Array<number>(a.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (
      j + 1 < idx.length &&
      (idx[j + 1] as readonly [number, number])[0] === (idx[i] as readonly [number, number])[0]
    )
      j++;
    for (let k = i; k <= j; k++) r[(idx[k] as readonly [number, number])[1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
};
const spearman = (a: number[], b: number[]) => {
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += ((ra[i] as number) - ma) * ((rb[i] as number) - mb);
    da += ((ra[i] as number) - ma) ** 2;
    db += ((rb[i] as number) - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
};

const rows: {
  name: string;
  price: number;
  total: number;
  noQuality: number;
  dims: Record<string, number>;
}[] = [];
for (const [name, price] of Object.entries(PRICES)) {
  const k = district.compounds.findIndex((c) => c.name === name);
  const bs = district.buildings.filter((b) => b.compound === k && b.core && b.cls === 'R');
  if (!bs.length) {
    console.log(`  （${name} 没有核心区住宅楼，跳过）`);
    continue;
  }
  const totals: number[] = [];
  const noQuality: number[] = [];
  const dims: Record<string, number[]> = {};
  for (const b of bs) {
    const l = livabilityOf(ctx, b.index);
    if (!l) continue;
    totals.push(l.total);
    // 去掉"物业与小区"一项、其余照常归一：看物理与区位那几项本身和房价对不对得上
    const rest = l.dimensions.filter((d) => d.key !== 'quality');
    const earned = rest.reduce((sum, d) => sum + d.score, 0);
    const possible = rest.reduce((sum, d) => sum + d.max, 0);
    noQuality.push((earned / possible) * 100 - l.penalties.reduce((sum, p) => sum + p.points, 0));
    for (const d of l.dimensions) (dims[d.label] ??= []).push(d.score / d.max);
  }
  rows.push({
    name,
    price,
    total: median(totals),
    noQuality: median(noQuality),
    dims: Object.fromEntries(Object.entries(dims).map(([k2, v]) => [k2, median(v)])),
  });
}
rows.sort((a, b) => b.price - a.price);
for (const r of rows)
  console.log(`${r.name.padEnd(10)} ${String(r.price).padStart(6)}  评分 ${r.total}`);
const prices = rows.map((r) => r.price);
console.log(
  `\n${rows.length} 个小区，总分与均价的秩相关 ρ = ${spearman(
    rows.map((r) => r.total),
    prices,
  ).toFixed(2)}`,
);
console.log(
  `  （不含物业与小区 ρ = ${spearman(
    rows.map((r) => r.noQuality),
    prices,
  ).toFixed(2)}）`,
);
for (const k of Object.keys(rows[0]?.dims ?? {})) {
  console.log(
    `  ${k.padEnd(6)} ρ = ${spearman(
      rows.map((r) => r.dims[k] ?? 0),
      prices,
    ).toFixed(2)}`,
  );
}
