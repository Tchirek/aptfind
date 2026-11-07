/**
 * 预计算核心区每栋住宅的宜居评分，写出 public/data/livability.json，屋顶按它着色。
 * 用的是页面上同一个 livabilityOf，点开一栋楼看到的分数与屋顶颜色对得上。
 * 改过 district.json、region.json 或日照之后要重跑。
 *
 * 用法：npx tsx scripts/precompute-livability.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { allEntrances } from '../src/app/entrances';
import { livabilityOf } from '../src/app/livabilityFacts';
import { Barriers, barrierSegments } from '../src/engine/barriers';
import { decodeDistrict } from '../src/engine/district';
import { buildSolids, buildWindowGrid, gridHash } from '../src/engine/geometry';
import { MetroGraph } from '../src/engine/metro';
import { decodeRegion, stationLines } from '../src/engine/region';
import { SunlightEngine } from '../src/engine/sunlight';
import { snapPois, WalkGraph } from '../src/engine/walk';

const DATA = new URL('../public/data/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DATA));

const district = decodeDistrict(JSON.parse(read('district.json').toString('utf8')));
const region = decodeRegion(JSON.parse(read('region.json').toString('utf8')));
const meta = JSON.parse(read('sunlight-dahan.json').toString('utf8')) as {
  count: number;
  gridHash: number;
  unit: number;
};
const grid = buildWindowGrid(district.buildings);
if (grid.count !== meta.count || gridHash(grid) !== meta.gridHash) {
  throw new Error('日照预计算与窗位网格对不上，先运行 npm run data:sunlight');
}
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
const pois = snapPois(graph, district.pois);
const ctx = {
  district,
  grid,
  dahanMinutes,
  windowRange,
  engine,
  graph,
  pois,
  metro: new MetroGraph(region),
  entrances: allEntrances(graph, region, district.pois),
  stationLines: stationLines(region),
};

const t0 = performance.now();
const scores: number[] = district.buildings.map(() => -1);
const targets = district.buildings.filter((b) => b.core && b.cls === 'R');
targets.forEach((b, k) => {
  const l = livabilityOf(ctx, b.index);
  if (l) scores[b.index] = l.total;
  if (process.stderr.isTTY && k % 50 === 0) process.stderr.write(`\r${k} / ${targets.length}`);
});
if (process.stderr.isTTY) process.stderr.write('\n');

const got = scores.filter((s) => s >= 0).sort((a, b) => a - b);
const q = (p: number) => got[Math.floor(p * (got.length - 1))] as number;
// 屋顶色阶的节点：按片区实际分数的分位，五档颜色都落在真实存在的楼上
const stops = [0.05, 0.25, 0.5, 0.75, 0.95].map(q);
writeFileSync(
  new URL('livability.json', DATA),
  `${JSON.stringify({ gridHash: meta.gridHash, stops, scores })}\n`,
);
console.log(
  `${got.length} 栋住宅，用时 ${((performance.now() - t0) / 1000).toFixed(1)} s；` +
    `分数 最低 ${q(0)} · 四分位 ${q(0.25)} / ${q(0.5)} / ${q(0.75)} · 最高 ${q(1)}`,
);
