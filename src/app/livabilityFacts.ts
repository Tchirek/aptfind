/**
 * 一栋楼的宜居评分：收集事实（日照、步行与地铁、视野、场地、楼宇），交给纯函数 scoreLivability。
 * 页面上的 LivabilityController 与离线的 scripts/precompute-livability.ts 共用这一份，
 * 屋顶按预计算的分数着色，与点开楼看到的分数必然一致。
 *
 * 这里不引用 app/data.ts（那边一导入就会去加载数据），只用它的类型。
 */

import type { District, Poi } from '../engine/district';
import { floorsOf, type WindowGrid, wallAzimuth } from '../engine/geometry';
import type { Entrance } from '../engine/isochrone';
import { type Livability, scoreLivability } from '../engine/livability';
import type { MetroGraph } from '../engine/metro';
import { builtCoverage, greenDistance, roadDistances } from '../engine/site';
import type { SunlightEngine } from '../engine/sunlight';
import { viewFrom } from '../engine/view';
import {
  type Access,
  accessFrom,
  buildingDoors,
  minutesOf,
  type SnappedPoi,
  snapPois,
  type WalkGraph,
} from '../engine/walk';

export interface LivabilityContext {
  district: District;
  grid: WindowGrid;
  dahanMinutes: Float32Array;
  windowRange: Uint32Array;
  engine: SunlightEngine;
  graph: WalkGraph;
  pois: readonly SnappedPoi[];
  metro: MetroGraph;
  entrances: readonly Entrance[];
  /** 每个车站经过的线路（engine/region 的 stationLines） */
  stationLines: readonly (readonly number[])[];
}

function centroid(ring: Float64Array): [number, number] {
  let x = 0;
  let y = 0;
  const n = ring.length / 2;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i] as number;
    y += ring[i + 1] as number;
  }
  return [x / n, y / n];
}

/** 楼所在小区的建成年代；小区没有就看上级地块 */
export function builtYearOf(d: District, compound: number): number | null {
  const c = d.compounds[compound];
  if (!c) return null;
  return c.builtYear ?? (c.parent >= 0 ? (d.compounds[c.parent]?.builtYear ?? null) : null);
}

/** 医院：名字里有"医院"，不算美容、口腔专科和宠物医院 */
const HOSPITAL = (p: Poi) =>
  p.category === 'medical' && /医院/.test(p.name) && !/美容|口腔|宠物|动物/.test(p.name);
const KINDERGARTEN = (p: Poi) => p.category === 'school' && /幼儿园|托育/.test(p.name);
/** 九年一贯制的"实验学校""师一学校"同时算小学与中学；小学只在没有划片数据时用 */
const PRIMARY = (p: Poi) => p.category === 'school' && /小学|实验学校|师一学校|附小/.test(p.name);
const MIDDLE = (p: Poi) =>
  p.category === 'school' && /中学|附中|高中|初中|实验学校|师一学校/.test(p.name);

/** 划片表里的公办小学，按步行网吸附一次（同一张步行网只做一遍） */
const snappedSchools = new WeakMap<WalkGraph, SnappedPoi[]>();
function schoolsOn(ctx: LivabilityContext): SnappedPoi[] {
  let s = snappedSchools.get(ctx.graph);
  if (!s) {
    s = snapPois(ctx.graph, ctx.district.schools);
    snappedSchools.set(ctx.graph, s);
  }
  return s;
}

/**
 * 小学：有划片就是对口的那所；没查到划片的小区取最近的公办小学，不算民办
 * （民办摇号入学，离得近也不一定上得了）。
 */
function primarySchoolOf(ctx: LivabilityContext, access: Access, compound: number) {
  const schools = schoolsOn(ctx);
  if (schools.length === 0)
    return { name: null, minutes: nearestMinutes(access, ctx.pois, PRIMARY) };
  const c = ctx.district.compounds[compound];
  const parent = c && c.parent >= 0 ? ctx.district.compounds[c.parent] : undefined;
  const k = c && c.primarySchool >= 0 ? c.primarySchool : (parent?.primarySchool ?? -1);
  const assigned = schools[k];
  if (assigned) {
    const d = (access.paths.dist[assigned.node] as number) + assigned.snap;
    return {
      name: assigned.poi.name,
      minutes: Number.isFinite(d) ? minutesOf(d) : Number.POSITIVE_INFINITY,
    };
  }
  return { name: null, minutes: nearestMinutes(access, schools, () => true) };
}

/** 在已算好的步行最短路上，找满足条件的最近一处，返回分钟数 */
function nearestMinutes(access: Access, pois: readonly SnappedPoi[], pick: (p: Poi) => boolean) {
  let best = Number.POSITIVE_INFINITY;
  for (const p of pois) {
    if (!pick(p.poi)) continue;
    const d = (access.paths.dist[p.node] as number) + p.snap;
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? minutesOf(best) : Number.POSITIVE_INFINITY;
}

/** 抽几扇窗外看出去：平均开阔度，与正对面遮挡物距离的中位数（楼间距） */
function windowView(ctx: LivabilityContext, b: number): { openness: number; spacing: number } {
  const start = ctx.windowRange[2 * b] as number;
  const n = ctx.windowRange[2 * b + 1] as number;
  if (n === 0) return { openness: 0, spacing: 0 };
  const samples = Math.min(8, n);
  let sum = 0;
  const fronts: number[] = [];
  for (let k = 0; k < samples; k++) {
    const i = start + Math.floor(((k + 0.5) * n) / samples);
    const v = viewFrom(ctx.engine, ctx.grid, i);
    sum += v.openness;
    fronts.push(v.frontDistance ?? 300);
  }
  fronts.sort((a, b2) => a - b2);
  return { openness: sum / samples, spacing: fronts[Math.floor(fronts.length / 2)] as number };
}

/** 点到多边形外轮廓的距离；在里面为 0 */
function distToRing(ring: Float64Array, x: number, y: number): number {
  let inside = false;
  let best = Number.POSITIVE_INFINITY;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[2 * j] as number;
    const ay = ring[2 * j + 1] as number;
    const bx = ring[2 * i] as number;
    const by = ring[2 * i + 1] as number;
    if (by > y !== ay > y && x < ((ax - bx) * (y - by)) / (ay - by) + bx) inside = !inside;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return inside ? 0 : best;
}

/** 楼外 radius 米内的餐饮家数（底商） */
function adjacentFood(d: District, ring: Float64Array, radius = 30): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i] as number);
    maxX = Math.max(maxX, ring[i] as number);
    minY = Math.min(minY, ring[i + 1] as number);
    maxY = Math.max(maxY, ring[i + 1] as number);
  }
  let n = 0;
  for (const p of d.pois) {
    if (p.category !== 'food') continue;
    if (p.x < minX - radius || p.x > maxX + radius || p.y < minY - radius || p.y > maxY + radius)
      continue;
    if (distToRing(ring, p.x, p.y) <= radius) n++;
  }
  return n;
}

/** 小区的物业费、绿化率、容积率、物业公司；小区没有就看上级地块 */
function propertyOf(d: District, compound: number) {
  const c = d.compounds[compound];
  const parent = c && c.parent >= 0 ? d.compounds[c.parent] : undefined;
  const pick = <K extends 'propertyFee' | 'greenRatio' | 'plotRatio' | 'propertyCompany'>(k: K) =>
    c?.[k] ?? parent?.[k] ?? null;
  return {
    fee: pick('propertyFee'),
    green: pick('greenRatio'),
    plotRatio: pick('plotRatio'),
    company: pick('propertyCompany'),
  };
}

/** 步行 15 分钟内能走到出入口的车站，一共经过几条不同的线 */
function linesWithinWalk(ctx: LivabilityContext, access: Access, minutes = 15): number {
  const lines = new Set<number>();
  for (const e of ctx.entrances) {
    const d = (access.paths.dist[e.node] as number) + e.snap;
    if (minutesOf(d) > minutes) continue;
    for (const l of ctx.stationLines[e.station] ?? []) lines.add(l);
  }
  return lines.size;
}

export function livabilityOf(ctx: LivabilityContext, building: number): Livability | null {
  const b = ctx.district.buildings[building];
  if (!b) return null;
  const ring = b.rings[0] as Float64Array;
  const [x, y] = centroid(ring);
  const start = ctx.windowRange[2 * building] as number;
  const count = ctx.windowRange[2 * building + 1] as number;
  const windows = ctx.dahanMinutes.subarray(start, start + count);
  const windowAzimuths = Float32Array.from({ length: count }, (_, k) =>
    wallAzimuth(ctx.grid, start + k),
  );

  const doors = buildingDoors(ctx.graph, ring);
  const access = accessFrom(ctx.graph, ctx.pois, doors, 3000);
  const cat = (key: string) => access.categories.find((c) => c.category === key);
  const minutes = (key: string) => {
    const meters = cat(key)?.meters;
    return meters === undefined || !Number.isFinite(meters)
      ? Number.POSITIVE_INFINITY
      : minutesOf(meters);
  };
  const view = windowView(ctx, building);
  const primary = primarySchoolOf(ctx, access, b.compound);

  return scoreLivability({
    windows,
    windowAzimuths,
    metroMinutes: minutes('metro'),
    metroLines: linesWithinWalk(ctx, access),
    busMinutes: minutes('bus'),
    groceryMinutes: minutes('grocery'),
    marketMinutes: minutes('market'),
    hospitalMinutes: nearestMinutes(access, ctx.pois, HOSPITAL),
    kindergartenMinutes: nearestMinutes(access, ctx.pois, KINDERGARTEN),
    primaryMinutes: primary.minutes,
    primarySchool: primary.name,
    middleMinutes: nearestMinutes(access, ctx.pois, MIDDLE),
    within10: {
      grocery: cat('grocery')?.within10 ?? 0,
      food: cat('food')?.within10 ?? 0,
      sport: cat('sport')?.within10 ?? 0,
    },
    openness: view.openness,
    spacing: view.spacing,
    greenMeters: greenDistance(ctx.district, x, y),
    coverage: builtCoverage(ctx.district, x, y),
    roads: roadDistances(ctx.district.roads, x, y),
    floors: floorsOf(b.height),
    floorsEstimated: b.source === 'cbmf' || b.source === 'plan',
    builtYear: builtYearOf(ctx.district, b.compound),
    foodAdjacent: adjacentFood(ctx.district, ring),
    property: propertyOf(ctx.district, b.compound),
  });
}
