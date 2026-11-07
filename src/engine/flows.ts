/**
 * 道路车流、人流压力：一年里任一天、任一时刻，每条路上大概有多挤。
 *
 * 没有实时的逐路流量，这里是一个按多方数据拼起来的模型：
 * - 时间：成都交管通报的拥堵指数（2025 年工作日高峰 1.65、平峰 1.31，晚高峰 17:00–19:30 压力最大，
 *   国庆前一个工作日晚高峰比平时高出近六成），成都地铁的分时客流（工作日 8–9 时、18–19 时两个高峰，
 *   暑期高峰占比下降、平峰上升），国务院节假日与调休安排，成都中小学与川师校历；
 * - 空间：OSM 的道路等级、车道数与单行，高德的餐饮、超市、地铁口、公交站、学校、公园，
 *   川师校园范围与沿河地段。
 * 每条路有几项权重（通勤、商业、上学、校园、休闲），每个时刻有几项系数，两者相乘就是那一刻的压力。
 */

import { type DayInfo, dayInfo } from './calendar';
import type { District, Road } from './district';
import type { CivilDate } from './solar';

/** 车流的三个来源：通勤过境、周边商业的进出、上学接送 */
export interface VehicleFactors {
  commute: number;
  local: number;
  school: number;
}

/** 人流的五个来源：上下班进出地铁公交、吃饭购物、上学放学、川师上下课、散步锻炼 */
export interface PedestrianFactors {
  commute: number;
  dining: number;
  school: number;
  campus: number;
  leisure: number;
}

export interface FlowFactors {
  vehicle: VehicleFactors;
  pedestrian: PedestrianFactors;
}

/** 0–24 时每小时一个值，中间线性插值 */
type Profile = readonly number[];

function at(p: Profile, minute: number): number {
  const h = (((minute / 60) % 24) + 24) % 24;
  const i = Math.floor(h);
  const t = h - i;
  return (p[i] as number) * (1 - t) + (p[i + 1] as number) * t;
}

// 车流：主干道上的压力（0–1），以工作日晚高峰为 1，平峰约为高峰的六成（对应拥堵指数 1.31 对 1.65）
const VEH_COMMUTE_WORK: Profile = [
  0.08, 0.05, 0.04, 0.04, 0.05, 0.1, 0.28, 0.7, 0.92, 0.8, 0.58, 0.56, 0.52, 0.52, 0.55, 0.58, 0.68,
  0.9, 1, 0.86, 0.6, 0.45, 0.32, 0.18, 0.08,
];
const VEH_COMMUTE_REST: Profile = [
  0.12, 0.08, 0.05, 0.04, 0.04, 0.06, 0.12, 0.22, 0.32, 0.45, 0.55, 0.6, 0.58, 0.56, 0.6, 0.64,
  0.68, 0.72, 0.7, 0.62, 0.52, 0.42, 0.32, 0.2, 0.12,
];
const VEH_LOCAL: Profile = [
  0.1, 0.06, 0.04, 0.03, 0.03, 0.05, 0.1, 0.25, 0.35, 0.4, 0.5, 0.7, 0.8, 0.6, 0.5, 0.5, 0.55, 0.75,
  0.9, 0.95, 0.8, 0.6, 0.4, 0.25, 0.1,
];
/** 中小学门口的接送：7:30 前后、16:30–17:30 */
const VEH_SCHOOL: Profile = [
  0, 0, 0, 0, 0, 0, 0.05, 0.85, 0.35, 0.05, 0, 0.1, 0.25, 0.1, 0.05, 0.1, 0.55, 1, 0.3, 0.05, 0, 0,
  0, 0, 0,
];

// 人流
const PED_COMMUTE_WORK: Profile = [
  0.03, 0.01, 0.01, 0.01, 0.02, 0.06, 0.25, 0.75, 1, 0.6, 0.32, 0.3, 0.35, 0.32, 0.3, 0.32, 0.4,
  0.7, 1, 0.75, 0.45, 0.35, 0.25, 0.12, 0.03,
];
const PED_COMMUTE_REST: Profile = [
  0.05, 0.02, 0.01, 0.01, 0.01, 0.03, 0.08, 0.18, 0.3, 0.42, 0.5, 0.55, 0.55, 0.52, 0.52, 0.55,
  0.58, 0.62, 0.62, 0.55, 0.45, 0.35, 0.25, 0.12, 0.05,
];
const PED_DINING: Profile = [
  0.12, 0.05, 0.02, 0.01, 0.01, 0.03, 0.15, 0.4, 0.45, 0.3, 0.3, 0.6, 1, 0.75, 0.4, 0.35, 0.4, 0.65,
  0.95, 1, 0.8, 0.55, 0.35, 0.22, 0.12,
];
const PED_SCHOOL: Profile = [
  0, 0, 0, 0, 0, 0, 0.05, 0.85, 0.65, 0.05, 0, 0.1, 0.45, 0.15, 0.05, 0.1, 0.5, 1, 0.35, 0.05, 0, 0,
  0, 0, 0,
];
/** 川师：上午、下午几次下课换教室，饭点与晚自习前后最多 */
const PED_CAMPUS: Profile = [
  0.05, 0.02, 0.01, 0.01, 0.01, 0.02, 0.15, 0.55, 0.8, 0.45, 0.7, 0.45, 1, 0.6, 0.7, 0.45, 0.6, 0.8,
  1, 0.75, 0.6, 0.75, 0.55, 0.2, 0.05,
];
/** 公园、河边：清早锻炼，晚饭后散步、跳坝坝舞 */
const PED_LEISURE: Profile = [
  0.03, 0.01, 0.01, 0.01, 0.02, 0.15, 0.55, 0.8, 0.55, 0.35, 0.3, 0.3, 0.25, 0.25, 0.3, 0.35, 0.45,
  0.5, 0.55, 0.85, 1, 0.75, 0.4, 0.12, 0.03,
];

/** 一年里的季节：夏天夜里人多、散得晚，中午热人少；冬天傍晚以后人少 */
function seasonal(
  month: number,
  minute: number,
): { evening: number; midday: number; late: number } {
  const h = minute / 60;
  const summer = month >= 6 && month <= 9;
  const winter = month === 12 || month <= 2;
  return {
    evening: summer ? 1.15 : winter ? 0.75 : 1,
    midday: summer && h >= 12 && h < 16 ? 0.75 : 1,
    // 夏夜宵夜到半夜
    late: summer && (h >= 21.5 || h < 1) ? 1.6 : winter && h >= 20 ? 0.75 : 1,
  };
}

export function flowFactors(
  date: CivilDate,
  minute: number,
  info: DayInfo = dayInfo(date),
): FlowFactors {
  const h = minute / 60;
  const work = info.kind === 'work';
  const s = seasonal(date.month, minute);
  const evening = h >= 17 && h < 22;

  // ---- 车流
  let commute = at(work ? VEH_COMMUTE_WORK : VEH_COMMUTE_REST, minute);
  let local = at(VEH_LOCAL, minute) * (work ? 0.85 : 1.1);
  const vschool = info.school ? at(VEH_SCHOOL, minute) : 0;
  if (work) {
    // 周三尾号限行后最不堵；周五傍晚最重；周一早上稍重
    if (info.weekday === 3) commute *= 0.94;
    if (info.weekday === 5 && h >= 16) commute *= 1.1;
    if (info.weekday === 1 && h < 11) commute *= 1.05;
    // 中小学放假时早高峰轻一些
    if (!info.school && h < 10) commute *= 0.85;
  }
  // 长假前一个工作日，下午起出城、回家的车多出许多（国庆前晚高峰高出近六成）
  if (info.eveOfLong && h >= 14 && h < 21) commute *= 1.45;
  if (info.holiday === 'spring') {
    commute *= 0.45;
    local *= 0.6;
  } else if (info.holiday === 'golden') {
    commute *= 0.85;
    local *= 1.2;
  }

  // ---- 人流
  let pcommute = at(work ? PED_COMMUTE_WORK : PED_COMMUTE_REST, minute);
  // 暑期地铁高峰占比下降、平峰上升
  if (!info.school && date.month >= 7 && date.month <= 8) pcommute = 0.85 * pcommute + 0.08;
  let dining =
    at(PED_DINING, minute) * (work ? 1 : 1.15) * s.late * (evening ? s.evening : 1) * s.midday;
  const pschool = info.school ? at(PED_SCHOOL, minute) : 0;
  let campus = at(PED_CAMPUS, minute) * (info.campus ? (work ? 1 : 0.55) : 0.12);
  let leisure =
    at(PED_LEISURE, minute) *
    (work ? 1 : h >= 9 && h < 18 ? 1.8 : 1.15) *
    (h >= 18 ? s.evening : h < 9 && (date.month === 12 || date.month <= 2) ? 0.7 : 1) *
    s.midday;
  if (info.holiday === 'spring') {
    pcommute *= 0.25;
    dining *= 0.75;
    campus *= 0.3;
  } else if (info.holiday === 'golden') {
    pcommute *= 0.4;
    dining *= 1.25;
    leisure *= 1.3;
  }

  return {
    vehicle: { commute, local, school: vschool },
    pedestrian: { commute: pcommute, dining, school: pschool, campus, leisure },
  };
}

// ---------------------------------------------------------------- 每条路的权重

/** 一条路在各来源上的权重，0–1 */
export interface RoadFlowWeights {
  /** 车流：通勤过境、商业进出、上学接送 */
  vehicle: VehicleFactors;
  /** 车的密度上限（按等级），与压力的换算（车道多的路同样多的车不那么挤） */
  vehicleBase: number;
  capacity: number;
  /** 人流 */
  pedestrian: PedestrianFactors;
  pedestrianBase: number;
}

/** 各级道路：车流基数、默认单向车道数、人行基数 */
const VEH_BASE = [1, 0.85, 0.62, 0.42, 0.18, 0.07];
const DEFAULT_LANES = [3, 3, 2, 1, 1, 1];
const PED_BASE = [0, 0.25, 0.45, 0.75, 0.6, 0.45];
const COMMUTE_SHARE = [1, 1, 0.9, 0.7, 0.4, 0.2];

interface Pt {
  x: number;
  y: number;
}

/** 折线上离 (x, y) 最近的距离 */
function distToRoad(r: Road, x: number, y: number): number {
  const p = r.points;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i] as number;
    const ay = p[i + 1] as number;
    const dx = (p[i + 2] as number) - ax;
    const dy = (p[i + 3] as number) - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}

function countNear(r: Road, pts: readonly Pt[], radius: number): number {
  let n = 0;
  for (const p of pts) if (distToRoad(r, p.x, p.y) <= radius) n++;
  return n;
}

const sat = (n: number, full: number) => Math.min(1, Math.log1p(n) / Math.log1p(full));

/** 点是否在多边形里（射线法） */
function inside(ring: Float64Array, x: number, y: number): boolean {
  let c = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i] as number;
    const yi = ring[2 * i + 1] as number;
    const xj = ring[2 * j] as number;
    const yj = ring[2 * j + 1] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function roadFlowWeights(d: District): RoadFlowWeights[] {
  const by = (cat: string) => d.pois.filter((p) => p.category === cat);
  const food = [...by('food'), ...by('grocery'), ...by('market')];
  const metro = by('metro');
  const bus = by('bus');
  const schools = by('school').filter((p) => /幼儿园|小学|中学|附中|实验学校|学校/.test(p.name));
  const parks = by('park');
  const campus = d.compounds.find((c) => c.kind === 'school' && /师范大学/.test(c.name));
  const campusRings = campus?.rings ?? [];

  return d.roads.map((r) => {
    const cls = Math.min(5, Math.max(0, r.cls));
    // 道路中点
    const mid = Math.floor(r.points.length / 4) * 2;
    const mx = r.points[mid] as number;
    const my = r.points[mid + 1] as number;
    const nearWater = d.water.some((w) =>
      w.line
        ? distToRoad({ ...r, points: w.line }, mx, my) < 80 + w.width / 2
        : w.ring
          ? distToRoad({ ...r, points: w.ring }, mx, my) < 80
          : false,
    );
    const lanes = r.lanes ?? (DEFAULT_LANES[cls] as number);
    const dirLanes = r.oneway ? lanes : Math.max(1, lanes / 2);
    return {
      vehicle: {
        commute: COMMUTE_SHARE[cls] as number,
        local: sat(countNear(r, food, 100), 40),
        school: cls <= 4 ? sat(countNear(r, schools, 150), 2) : 0,
      },
      vehicleBase: VEH_BASE[cls] as number,
      capacity: Math.min(1.3, Math.max(0.7, (DEFAULT_LANES[cls] as number) / dirLanes)),
      pedestrian: {
        commute: Math.min(
          1,
          sat(countNear(r, metro, 150), 3) + 0.5 * sat(countNear(r, bus, 60), 2),
        ),
        dining: sat(countNear(r, food, 70), 30),
        school: sat(countNear(r, schools, 120), 2),
        campus: campusRings.some((ring) => inside(ring, mx, my)) ? 1 : 0,
        leisure: Math.min(1, (nearWater ? 0.7 : 0) + sat(countNear(r, parks, 120), 2)),
      },
      pedestrianBase: PED_BASE[cls] as number,
    };
  });
}

/** 某条路在某组时间系数下的车流密度（0–1）与压力（0–1，越大越堵） */
export function vehicleLoad(
  w: RoadFlowWeights,
  f: VehicleFactors,
): { density: number; pressure: number } {
  const v = w.vehicle;
  const demand =
    w.vehicleBase *
    Math.min(1.4, v.commute * f.commute + 0.45 * v.local * f.local + 0.6 * v.school * f.school);
  return { density: Math.min(1, demand), pressure: Math.min(1, demand * w.capacity) };
}

/** 某条人行道在某组时间系数下的人流密度（0–1） */
export function pedestrianLoad(w: RoadFlowWeights, f: PedestrianFactors): number {
  const p = w.pedestrian;
  // 没有什么吸引人的街道只有零星路人；地铁口、饭馆、学校、校园、河边才热闹
  const pull =
    0.06 +
    p.commute * f.commute +
    0.8 * p.dining * f.dining +
    p.school * f.school +
    p.campus * f.campus +
    0.8 * p.leisure * f.leisure;
  return Math.min(1, w.pedestrianBase * pull);
}
