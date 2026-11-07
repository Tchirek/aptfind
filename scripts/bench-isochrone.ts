/** 用真实数据跑一次可达范围，看耗时与结果是否合理：npx tsx scripts/bench-isochrone.ts [楼名关键字] */
import { readFileSync } from 'node:fs';
import { decodeDistrict } from '../src/engine/district';
import {
  computeIsochrone,
  fieldGrid,
  rasterizeField,
  reachableArea,
  snapEntrances,
} from '../src/engine/isochrone';
import { MetroGraph } from '../src/engine/metro';
import { decodeRegion } from '../src/engine/region';
import { buildingDoors, WalkGraph } from '../src/engine/walk';

const district = decodeDistrict(JSON.parse(readFileSync('public/data/district.json', 'utf8')));
const region = decodeRegion(JSON.parse(readFileSync('public/data/region.json', 'utf8')));
const key = process.argv[2] ?? '图书馆';
const b =
  district.buildings.find((x) => x.label?.includes(key) && x.core) ??
  district.buildings.find((x) => x.core);
if (!b) throw new Error('no building');

let t = performance.now();
const lap = (s: string) => {
  const now = performance.now();
  console.log(`${s.padEnd(16)} ${(now - t).toFixed(1)} ms`);
  t = now;
};
const graph = new WalkGraph(region.walk);
const metro = new MetroGraph(region);
const entrances = snapEntrances(graph, region);
lap('建图');
const doors = buildingDoors(graph, b.rings[0] as Float64Array);
lap(`出入口 ${doors.length}`);
const iso = computeIsochrone(graph, metro, entrances, doors);
lap('等时计算');
const cx = (b.rings[0] as Float64Array)[0] as number;
const cy = (b.rings[0] as Float64Array)[1] as number;
const near = fieldGrid(graph, iso.combined, 30, {
  margin: 200,
  maxCells: 1100,
  minCell: 4,
  around: [cx, cy, 2700],
});
const far = fieldGrid(graph, iso.combined, 30, { margin: 300, maxCells: 1400, minCell: 8 });
lap('网格');
if (!near || !far) throw new Error('no grid');
const nf = rasterizeField(graph, iso, near, 75);
lap(`近场 ${near.nx}×${near.ny} @${near.cell.toFixed(1)}m`);
const ff = rasterizeField(graph, iso, far, 75);
lap(`远场 ${far.nx}×${far.ny} @${far.cell.toFixed(1)}m`);
console.log(b.label, '出入口', doors.length);
console.log('15 分钟步行面积', (reachableArea(nf, near, 0, 15) / 1e6).toFixed(2), 'km²');
console.log('30 分钟步行面积', (reachableArea(nf, near, 0, 30) / 1e6).toFixed(2), 'km²');
console.log('30 分钟步行+地铁面积', (reachableArea(ff, far, 1, 30) / 1e6).toFixed(2), 'km²');
console.log(
  '出站车站',
  iso.stations.length,
  iso.stations
    .slice(0, 40)
    .map(
      (s) =>
        `${region.stations[s.station]?.name} ${s.exit.toFixed(1)}(${s.lines.map((l) => region.lines[l]?.ref).join('>')})`,
    )
    .join('，'),
);
console.log('乘车区间', iso.legs.length);
