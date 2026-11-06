/**
 * 预计算核心区每个窗位大寒日的日照时数，写出 public/data/sunlight-dahan.bin 和同名 .json。
 * 页面打开时直接加载这份结果，不必在浏览器里算 20 多万个窗位。
 *
 * 用法：npx tsx scripts/precompute-sunlight.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { decodeDistrict } from '../src/engine/district';
import { buildSolids, buildWindowGrid, gridHash } from '../src/engine/geometry';
import { solarTermUtc, utcToBeijingDate } from '../src/engine/solar';
import { RULE_DAHAN } from '../src/engine/standard';
import { SunlightEngine, SunPath } from '../src/engine/sunlight';

const DATA = new URL('../public/data/', import.meta.url);
const YEAR = 2027;

/** 以 1/4 分钟为单位存成 Uint16，最多 16383 分钟，足够 */
export const QUARTER_MINUTE = 4;

const district = decodeDistrict(JSON.parse(readFileSync(new URL('district.json', DATA), 'utf8')));
const engine = new SunlightEngine(buildSolids(district.buildings));
const grid = buildWindowGrid(district.buildings);
const date = utcToBeijingDate(solarTermUtc(YEAR, RULE_DAHAN.term));
const path = new SunPath({
  date,
  startTst: RULE_DAHAN.startTst,
  endTst: RULE_DAHAN.endTst,
  lat: district.origin.lat,
  lon: district.origin.lon,
});

const minutes = new Uint16Array(grid.count);
const chunk = 5000;
const buf = new Float32Array(chunk);
const t0 = performance.now();
for (let from = 0; from < grid.count; from += chunk) {
  const to = Math.min(grid.count, from + chunk);
  engine.computeRange(grid, path, from, to, buf);
  for (let i = from; i < to; i++)
    minutes[i] = Math.round((buf[i - from] as number) * QUARTER_MINUTE);
  if (process.stderr.isTTY) process.stderr.write(`\r${to} / ${grid.count}`);
}
if (process.stderr.isTTY) process.stderr.write('\n');

writeFileSync(new URL('sunlight-dahan.bin', DATA), new Uint8Array(minutes.buffer));
const meta = {
  rule: RULE_DAHAN.id,
  date,
  startTst: RULE_DAHAN.startTst,
  endTst: RULE_DAHAN.endTst,
  count: grid.count,
  gridHash: gridHash(grid),
  unit: 1 / QUARTER_MINUTE,
};
writeFileSync(new URL('sunlight-dahan.json', DATA), `${JSON.stringify(meta, null, 2)}\n`);

let below = 0;
for (const m of minutes) if (m < RULE_DAHAN.requiredMinutes * QUARTER_MINUTE) below++;
console.log(
  `${grid.count} 个窗位，用时 ${((performance.now() - t0) / 1000).toFixed(1)} s；` +
    `大寒日不足 2 小时 ${below} 个（${((below / grid.count) * 100).toFixed(1)}%）`,
);
