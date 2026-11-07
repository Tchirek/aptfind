/** 楼的出入口接到步行网的那一小段，有多少穿过河或大路：npx tsx scripts/check-connectors.ts */
import { readFileSync } from 'node:fs';
import { Barriers, barrierSegments } from '../src/engine/barriers';
import { decodeDistrict } from '../src/engine/district';
import { decodeRegion } from '../src/engine/region';
import { buildingDoors, snapPois, WalkGraph } from '../src/engine/walk';

const DATA = new URL('../public/data/', import.meta.url);
const district = decodeDistrict(JSON.parse(readFileSync(new URL('district.json', DATA), 'utf8')));
const region = decodeRegion(JSON.parse(readFileSync(new URL('region.json', DATA), 'utf8')));
const barriers = new Barriers(barrierSegments(district));
const graph = new WalkGraph(region.walk);

const count = (g: WalkGraph) => {
  let doors = 0;
  let bad = 0;
  for (const b of district.buildings) {
    if (!b.core) continue;
    for (const d of buildingDoors(g, b.rings[0] as Float64Array)) {
      doors++;
      if (barriers.crosses(d.x, d.y, g.x(d.node), g.y(d.node))) bad++;
    }
  }
  let poiBad = 0;
  for (const p of snapPois(g, district.pois)) {
    if (barriers.crosses(p.poi.x, p.poi.y, g.x(p.node), g.y(p.node))) poiBad++;
  }
  return { doors, bad, poiBad };
};
console.log('不设屏障', count(graph));
graph.setBarriers(barriers);
console.log('设屏障  ', count(graph));
