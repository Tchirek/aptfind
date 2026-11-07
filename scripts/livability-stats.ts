/** 看宜居评分各维度在核心区住宅上的分布，调参用：npx tsx scripts/livability-stats.ts */
import { readFileSync } from 'node:fs';
import { allEntrances } from '../src/app/entrances';
import { livabilityOf } from '../src/app/livabilityFacts';
import { Barriers, barrierSegments } from '../src/engine/barriers';
import { decodeDistrict } from '../src/engine/district';
import { buildSolids, buildWindowGrid } from '../src/engine/geometry';
import { MetroGraph } from '../src/engine/metro';
import { decodeRegion } from '../src/engine/region';
import { SunlightEngine } from '../src/engine/sunlight';
import { snapPois, WalkGraph } from '../src/engine/walk';

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
};
const dims = new Map<string, number[]>();
const totals: number[] = [];
for (const b of district.buildings) {
  if (!b.core || b.cls !== 'R') continue;
  const l = livabilityOf(ctx as never, b.index);
  if (!l) continue;
  totals.push(l.total);
  for (const d of l.dimensions) {
    const k = `${d.label}/${d.max}`;
    if (!dims.has(k)) dims.set(k, []);
    dims.get(k)?.push(d.score / d.max);
  }
  for (const p of l.penalties) {
    if (!dims.has(p.label)) dims.set(p.label, []);
    dims.get(p.label)?.push(p.points);
  }
}
const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return (s[Math.floor(p * (s.length - 1))] as number).toFixed(2);
};
const show = (name: string, a: number[]) =>
  console.log(
    `${name.padEnd(12)} n=${a.length}  p5 ${q(a, 0.05)}  p25 ${q(a, 0.25)}  p50 ${q(a, 0.5)}  p75 ${q(a, 0.75)}  p95 ${q(a, 0.95)}`,
  );
show('总分', totals);
for (const [k, v] of dims) show(k, v);

// 按小区看中位分：排名是否合乎常识
const byCompound = new Map<string, number[]>();
for (const b of district.buildings) {
  if (!b.core || b.cls !== 'R' || b.compound < 0) continue;
  const l = livabilityOf(ctx as never, b.index);
  if (!l) continue;
  const name = district.compounds[b.compound]?.name ?? '';
  if (!byCompound.has(name)) byCompound.set(name, []);
  byCompound.get(name)?.push(l.total);
}
const ranked = [...byCompound]
  .filter(([, v]) => v.length >= 3)
  .map(([n, v]) => [n, Number(q(v, 0.5)), v.length] as const)
  .sort((a, b) => b[1] - a[1]);
console.log(
  '最好',
  ranked
    .slice(0, 8)
    .map(([n, s, c]) => `${n} ${s}(${c})`)
    .join('，'),
);
console.log(
  '最差',
  ranked
    .slice(-8)
    .map(([n, s, c]) => `${n} ${s}(${c})`)
    .join('，'),
);

// 看几个小区的逐项明细
for (const name of (process.env.SHOW ?? '').split(',').filter(Boolean)) {
  const k = district.compounds.findIndex((c) => c.name === name);
  const b = district.buildings
    .filter((x) => x.compound === k && x.core && x.cls === 'R')
    .sort((x, y) => y.height - x.height)[0];
  if (!b) continue;
  const l = livabilityOf(ctx as never, b.index);
  console.log(`
${name} #${b.index} ${Math.round(b.height / 3)} 层 → ${l?.total}`);
  for (const d of l?.dimensions ?? [])
    console.log(`  ${d.label} ${d.score.toFixed(1)}/${d.max}  ${d.detail}`);
  for (const p of l?.penalties ?? []) console.log(`  −${p.points.toFixed(1)} ${p.detail}`);
}
