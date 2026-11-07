/** 看几个典型时刻各档路况占干道长度的比例，调参用：npx tsx scripts/traffic-stats.ts */
import { readFileSync } from 'node:fs';
import { dayInfo } from '../src/engine/calendar';
import { decodeDistrict } from '../src/engine/district';
import {
  flowFactors,
  pedestrianLoad,
  roadFlowWeights,
  tidalFactor,
  trafficLevel,
  vehicleLoad,
} from '../src/engine/flows';

const district = decodeDistrict(
  JSON.parse(readFileSync(new URL('../public/data/district.json', import.meta.url), 'utf8')),
);
const weights = roadFlowWeights(district);
const cases: [string, { year: number; month: number; day: number }, number][] = [
  ['周二 03:00', { year: 2026, month: 11, day: 10 }, 180],
  ['周二 08:30', { year: 2026, month: 11, day: 10 }, 510],
  ['周二 12:30', { year: 2026, month: 11, day: 10 }, 750],
  ['周二 18:00', { year: 2026, month: 11, day: 10 }, 1080],
  ['周三 18:00', { year: 2026, month: 11, day: 11 }, 1080],
  ['国庆前 18:00', { year: 2026, month: 9, day: 30 }, 1080],
  ['周六 15:00', { year: 2026, month: 11, day: 14 }, 900],
  ['春节 15:00', { year: 2026, month: 2, day: 19 }, 900],
];
for (const [name, date, minute] of cases) {
  const f = flowFactors(date, minute);
  const work = dayInfo(date).kind === 'work';
  const len = [0, 0, 0, 0];
  let ped = 0;
  let pedN = 0;
  district.roads.forEach((r, i) => {
    const w = weights[i];
    if (!w) return;
    ped += pedestrianLoad(w, f.pedestrian);
    pedN++;
    if (r.cls > 3) return;
    const p = r.points;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const dx = (p[k + 2] as number) - (p[k] as number);
      const dy = (p[k + 3] as number) - (p[k + 1] as number);
      const l = Math.hypot(dx, dy);
      if (l < 1) continue;
      const dirs = r.oneway ? [r.oneway] : [1, -1];
      for (const s of dirs) {
        const pr =
          vehicleLoad(w, f.vehicle).pressure *
          tidalFactor((s * dx) / l, (s * dy) / l, minute, work);
        len[trafficLevel(pr)] = (len[trafficLevel(pr)] as number) + l;
      }
    }
  });
  const tot = len.reduce((a, b) => a + b, 0);
  console.log(
    `${name.padEnd(10)} ${len.map((v) => `${Math.round((v / tot) * 100)}%`.padStart(4)).join(' ')}   人流均值 ${(ped / pedN).toFixed(2)}`,
  );
}
